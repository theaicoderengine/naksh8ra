"use client";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
  }
}

type Opts = { method?: string; body?: unknown; org?: string; form?: FormData; headers?: Record<string, string>; signal?: AbortSignal };

/** Typed fetch wrapper for /api/v1. Sends the active organisation slug; the server verifies membership. */
export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...(opts.headers ?? {}) };
  if (opts.org) headers["x-atlas-org"] = opts.org;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api/v1${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin", signal: opts.signal });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    if (!res.ok) throw new ApiError("INTERNAL", `Request failed (${res.status})`, res.status);
    return (await res.text()) as T;
  }
  const json = await res.json();
  if (!res.ok) {
    const e = json?.error ?? {};
    if (e.code === "UNAUTHENTICATED" && typeof window !== "undefined" && !path.startsWith("/auth/") && !path.startsWith("/interview-session")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    if (e.code === "MFA_REQUIRED" && typeof window !== "undefined" && !path.startsWith("/auth/mfa")) {
      window.location.href = `/login/mfa?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(e.code ?? "INTERNAL", e.message ?? "Something went wrong", res.status, e.details);
  }
  return json.data as T;
}
