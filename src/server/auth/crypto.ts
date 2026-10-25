import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

// scrypt parameters: N=2^15, r=8, p=1 (~32 MiB, OWASP-recommended minimum).
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Equalise timing for unknown accounts.
    await scrypt("dummy-password", Buffer.alloc(16), KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
    return false;
  }
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return crypto.timingSafeEqual(key, expected);
}

/** URL-safe random token (256 bits). Only its SHA-256 hash is stored. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseKey(k: string, name: string): Buffer {
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) throw new Error(`${name} must be 32 bytes base64`);
  return buf;
}

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) {
    if (process.env.APP_ENV === "production" || process.env.APP_ENV === "staging") {
      throw new Error("ENCRYPTION_KEY not configured");
    }
    // Development-only deterministic key; never used outside dev/test (env.ts enforces).
    return crypto.createHash("sha256").update("atlas-dev-only-key").digest();
  }
  return parseKey(k, "ENCRYPTION_KEY");
}

/** Key being rotated out: still accepted for decryption until re-encryption completes. */
function previousKey(): Buffer | null {
  const k = process.env.ENCRYPTION_KEY_PREVIOUS;
  return k ? parseKey(k, "ENCRYPTION_KEY_PREVIOUS") : null;
}

/** AES-256-GCM authenticated encryption for secrets at rest (always with the current key). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

function decryptWith(k: Buffer, payload: string): string {
  const [v, ivB, tagB, ctB] = payload.split(".");
  if (v !== "v1" || !ivB || !tagB || ctB === undefined) throw new Error("Unsupported ciphertext version");
  const decipher = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Decrypt with the current key, falling back to ENCRYPTION_KEY_PREVIOUS during a key
 * rotation (GCM authentication tells us which key the ciphertext was made with).
 * `keyUsed` lets the re-encryption job find secrets still on the old key.
 */
export function decryptWithInfo(payload: string): { plain: string; keyUsed: "current" | "previous" } {
  try {
    return { plain: decryptWith(key(), payload), keyUsed: "current" };
  } catch (err) {
    const prev = previousKey();
    if (!prev) throw err;
    return { plain: decryptWith(prev, payload), keyUsed: "previous" };
  }
}

export function decrypt(payload: string): string {
  return decryptWithInfo(payload).plain;
}

export function hmac(secret: string, data: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
