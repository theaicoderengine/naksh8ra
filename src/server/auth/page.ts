import "server-only";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { currentSession, type SessionInfo } from "./session";
import { resolveOrgContext, type OrgContext } from "./context";
import { AppError } from "../errors";
import { platformCan, type PlatformPermission } from "../rbac/permissions";

async function here() {
  const h = await headers();
  return h.get("x-pathname") ?? "/";
}

/** Server component guard: signed-in user (MFA completed when enabled). */
export async function requirePageSession(): Promise<SessionInfo> {
  const s = await currentSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(await here())}`);
  if (s.user.mfaEnabledAt && !s.mfaVerified) redirect(`/login/mfa?next=${encodeURIComponent(await here())}`);
  return s;
}

export async function requireVerifiedPage(): Promise<SessionInfo> {
  const s = await requirePageSession();
  if (!s.user.emailVerifiedAt) redirect("/verify-email/sent");
  return s;
}

export async function requirePageOrg(slug: string): Promise<OrgContext> {
  const s = await requireVerifiedPage();
  try {
    return await resolveOrgContext(s, slug);
  } catch (e) {
    if (e instanceof AppError && e.code === "MFA_REQUIRED") redirect("/account/security?mfa=required");
    if (e instanceof AppError && e.code === "FORBIDDEN") redirect(`/suspended?org=${encodeURIComponent(slug)}`);
    notFound();
  }
}

export async function requirePlatformPage(p: PlatformPermission = "platform.orgs.view"): Promise<SessionInfo> {
  const s = await requirePageSession();
  if (!platformCan(s.user.platformRole, p)) notFound();
  if (!s.user.mfaEnabledAt) redirect("/account/security?mfa=required");
  if (!s.mfaVerified) redirect(`/login/mfa?next=/admin`);
  return s;
}
