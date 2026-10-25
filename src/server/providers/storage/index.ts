import fs from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../env";
import { AppError } from "../../errors";

/**
 * Private object storage. Objects are never publicly readable: downloads go
 * through /api/v1/files/:id which re-checks authorisation on every request,
 * then streams (local) or redirects to a 60-second presigned URL (S3).
 */
export interface StorageProvider {
  name: string;
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, fileName: string, ttlSec?: number): Promise<string | null>;
}

class LocalStorage implements StorageProvider {
  name = "local";
  private root = path.resolve(env().STORAGE_LOCAL_DIR);
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new AppError("BAD_REQUEST", "Invalid storage key");
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body, { mode: 0o600 });
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
  async signedUrl() {
    return null; // streamed by the API instead
  }
}

class S3Storage implements StorageProvider {
  name = "s3";
  private client: S3Client;
  private bucket: string;
  constructor() {
    const e = env();
    if (!e.S3_BUCKET || !e.S3_REGION) throw new AppError("PROVIDER_NOT_CONFIGURED", "S3_BUCKET and S3_REGION are required");
    this.bucket = e.S3_BUCKET;
    this.client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY } : undefined,
    });
  }
  async put(key: string, body: Buffer, mime: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mime, ...(env().S3_SSE === "AES256" ? { ServerSideEncryption: "AES256" as const } : {}) }));
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async signedUrl(key: string, fileName: string, ttlSec = 60) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${fileName.replace(/[^\w.\- ]/g, "_")}"` }),
      { expiresIn: ttlSec },
    );
  }
}

let provider: StorageProvider | null = null;
export function storage(): StorageProvider {
  if (!provider) provider = env().STORAGE_PROVIDER === "s3" ? new S3Storage() : new LocalStorage();
  return provider;
}
