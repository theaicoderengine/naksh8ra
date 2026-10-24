import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: exposes the request path to server components (for
 * post-login redirects) and adds a request id. Authentication and
 * authorisation are enforced server-side in route handlers and pages —
 * never here alone.
 */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname + req.nextUrl.search);
  if (!headers.get("x-request-id")) headers.set("x-request-id", crypto.randomUUID());
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
