import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { AppError, toErrorBody } from "../errors";
import { logger } from "../logger";
import { SESSION_COOKIE, resolveSessionToken, type SessionInfo } from "../auth/session";
import { resolveOrgContext, requirePlatform, requireVerified, type OrgContext } from "../auth/context";
import type { Permission, PlatformPermission } from "../rbac/permissions";
import { rateLimit, RULES } from "../rate-limit";
import { runWithDeadline } from "../deadline";
import { env } from "../env";

const MAX_JSON_BYTES = 1024 * 1024;

export type RequestMeta = { ip: string | null; userAgent: string | null; requestId: string };

type AuthMode = "none" | "optional" | "session" | "verified" | "org";

type Opts<B extends z.ZodTypeAny | undefined, Q extends z.ZodTypeAny | undefined> = {
  auth: AuthMode;
  permission?: Permission;
  platform?: PlatformPermission;
  body?: B;
  query?: Q;
  rateLimit?: keyof typeof RULES;
  /** Origin check for state-changing requests. Disable only for signed webhooks. */
  csrf?: boolean;
  /** Raw body handling (multipart / webhooks): the handler reads req itself. */
  rawBody?: boolean;
  /** Allow sessions that have passed the password step but not yet MFA. */
  allowPartialMfa?: boolean;
};

type Args<B, Q, A extends AuthMode> = {
  req: NextRequest;
  params: Record<string, string>;
  body: B;
  query: Q;
  meta: RequestMeta;
  session: A extends "none" ? null : A extends "optional" ? SessionInfo | null : SessionInfo;
  org: A extends "org" ? OrgContext : null;
};

/**
 * Client IP for rate limits and audit. Proxies append the address they received the request from,
 * so with TRUST_PROXY the trustworthy entry is the one TRUST_PROXY_HOPS from the right (1 = the
 * proxy in front of the app, e.g. Hostinger's or an AWS ALB). Entries further left are
 * client-supplied and can be forged.
 */
export function clientIp(h: Headers): string | null {
  const parts = (h.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (process.env.TRUST_PROXY === "true" && parts.length) {
    const hops = Math.max(1, Number(process.env.TRUST_PROXY_HOPS ?? 1) || 1);
    return parts[Math.max(0, parts.length - hops)];
  }
  return h.get("x-real-ip") ?? parts.at(-1) ?? null;
}

export function getMeta(req: NextRequest): RequestMeta {
  return {
    ip: clientIp(req.headers),
    userAgent: req.headers.get("user-agent"),
    requestId: req.headers.get("x-request-id") ?? crypto.randomUUID(),
  };
}

function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin") ?? (req.headers.get("referer") ? new URL(req.headers.get("referer")!).origin : null);
  if (!origin) throw new AppError("CSRF_FAILED", "Missing request origin");
  const allowed = new Set<string>();
  const appUrl = process.env.APP_URL;
  if (appUrl) allowed.add(new URL(appUrl).origin);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }
  if (!allowed.has(origin)) throw new AppError("CSRF_FAILED", "Cross-origin request rejected");
}

export function route<B extends z.ZodTypeAny | undefined = undefined, Q extends z.ZodTypeAny | undefined = undefined, A extends AuthMode = AuthMode>(
  opts: Opts<B, Q> & { auth: A },
  handler: (
    args: Args<B extends z.ZodTypeAny ? z.infer<B> : undefined, Q extends z.ZodTypeAny ? z.infer<Q> : undefined, A>,
  ) => Promise<unknown>,
) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    const meta = getMeta(req);
    const started = Date.now();
    try {
      const method = req.method.toUpperCase();
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
      if (mutating && opts.csrf !== false) checkOrigin(req);

      let session: SessionInfo | null = null;
      if (opts.auth !== "none") {
        session = await resolveSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
        if (!session && opts.auth !== "optional") throw new AppError("UNAUTHENTICATED", "Authentication required");
      }
      if (session && session.user.mfaEnabledAt && !session.mfaVerified && !opts.allowPartialMfa) {
        throw new AppError("MFA_REQUIRED", "Two-factor verification required");
      }
      if (session && (opts.auth === "verified" || opts.auth === "org")) requireVerified(session);
      if (opts.platform) requirePlatform(session!, opts.platform);

      let org: OrgContext | null = null;
      if (opts.auth === "org") {
        org = await resolveOrgContext(session!, req.headers.get("x-atlas-org") ?? req.nextUrl.searchParams.get("org"));
        if (opts.permission) org.assert(opts.permission);
      }

      if (opts.rateLimit) await rateLimit(opts.rateLimit, session?.user.id ?? meta.ip ?? "anon");
      else if (mutating && session) await rateLimit("mutation", session.user.id);

      let body: unknown = undefined;
      if (opts.body && !opts.rawBody) {
        const ct = req.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) throw new AppError("BAD_REQUEST", "Expected application/json");
        // JSON bodies are small forms; cap them before parsing/validation so an
        // oversized payload cannot exhaust memory (uploads use multipart routes).
        const declared = Number(req.headers.get("content-length") ?? 0);
        if (declared > MAX_JSON_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Request body is too large");
        const text = await req.text();
        if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Request body is too large");
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new AppError("BAD_REQUEST", "Malformed JSON body");
        }
        body = opts.body.parse(json);
      }
      let query: unknown = undefined;
      if (opts.query) query = opts.query.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));

      const params = ctx?.params ? await ctx.params : {};
      // Bounded so provider calls end cleanly before the host cuts the request off.
      const result = await runWithDeadline(env().REQUEST_DEADLINE_MS, () => handler({ req, params, body, query, meta, session, org } as never));
      const res = result instanceof Response ? result : NextResponse.json({ data: result ?? null });
      res.headers.set("x-request-id", meta.requestId);
      logger.info({ method, path: req.nextUrl.pathname, status: res.status, ms: Date.now() - started, requestId: meta.requestId }, "request");
      return res;
    } catch (err) {
      const { status, body } = toErrorBody(err, meta.requestId);
      if (status >= 500) logger.error({ err, path: req.nextUrl.pathname, requestId: meta.requestId }, "request failed");
      else logger.info({ path: req.nextUrl.pathname, status, code: body.error.code, requestId: meta.requestId }, "request rejected");
      const res = NextResponse.json(body, { status });
      if (status === 429 && (body.error.details as { retryAfterSec?: number })?.retryAfterSec) {
        res.headers.set("retry-after", String((body.error.details as { retryAfterSec: number }).retryAfterSec));
      }
      res.headers.set("x-request-id", meta.requestId);
      return res;
    }
  };
}

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
