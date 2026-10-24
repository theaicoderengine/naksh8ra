import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export type ErrorCode =
  | "BAD_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "MFA_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "RATE_LIMITED"
  | "PAYMENT_REQUIRED"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "CSRF_FAILED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  MFA_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  PAYMENT_REQUIRED: 402,
  PROVIDER_NOT_CONFIGURED: 503,
  PROVIDER_ERROR: 502,
  CSRF_FAILED: 403,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return STATUS[this.code];
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError("BAD_REQUEST", m, d);
export const unauthenticated = (m = "Authentication required") => new AppError("UNAUTHENTICATED", m);
export const forbidden = (m = "You do not have permission to perform this action") => new AppError("FORBIDDEN", m);
// Deliberately generic: a missing resource and a resource in another tenant
// produce the identical response, so IDs cannot be probed across tenants.
export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);
export const conflict = (m: string, d?: unknown) => new AppError("CONFLICT", m, d);
export const invalidState = (m: string, d?: unknown) => new AppError("INVALID_STATE", m, d);

export type ErrorBody = { error: { code: ErrorCode; message: string; details?: unknown; requestId?: string } };

export function toErrorBody(err: unknown, requestId?: string): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details, requestId } } };
  }
  if (err instanceof ZodError) {
    return {
      status: 422,
      body: {
        error: {
          code: "VALIDATION_FAILED",
          message: "Request validation failed",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          requestId,
        },
      },
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return { status: 409, body: { error: { code: "CONFLICT", message: "A record with these details already exists", requestId } } };
    }
    if (err.code === "P2025") {
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "Resource not found", requestId } } };
    }
  }
  // Never leak internals (stack traces, SQL, provider payloads) to clients.
  return { status: 500, body: { error: { code: "INTERNAL", message: "An unexpected error occurred", requestId } } };
}
