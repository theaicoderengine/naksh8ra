import pino from "pino";

/**
 * Structured logger. Redaction rules (see docs/security.md#logging):
 * credentials, tokens, cookies, resumes, transcripts and answer content are
 * never written to logs.
 */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "*.tokenHash",
  "authorization",
  "*.authorization",
  "headers.cookie",
  "*.headers.cookie",
  "cookie",
  "mfaSecret",
  "*.mfaSecret",
  "transcript",
  "*.transcript",
  "extractedText",
  "*.extractedText",
  "textResponse",
  "*.textResponse",
  "apiKey",
  "*.apiKey",
  "secret",
  "*.secret",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  base: { service: process.env.SERVICE_NAME ?? "atlas-web", env: process.env.APP_ENV ?? "development" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
