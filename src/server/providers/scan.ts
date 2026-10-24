import net from "node:net";
import { env } from "../env";

export type ScanResult = { status: "CLEAN" | "INFECTED" | "NOT_SCANNED" | "FAILED"; detail?: string };

/** ClamAV INSTREAM scan over TCP (clamd). Returns NOT_SCANNED when no scanner is configured. */
export async function scanBuffer(buf: Buffer): Promise<ScanResult> {
  if (env().MALWARE_SCANNER !== "clamav") return { status: "NOT_SCANNED" };
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: env().CLAMAV_HOST, port: env().CLAMAV_PORT });
    let response = "";
    const done = (r: ScanResult) => {
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(30_000, () => done({ status: "FAILED", detail: "timeout" }));
    socket.on("error", (e) => done({ status: "FAILED", detail: e.message }));
    socket.on("data", (d) => (response += d.toString()));
    socket.on("end", () => {
      if (/OK\s*$/.test(response.replace(/\0/g, ""))) done({ status: "CLEAN" });
      else if (/FOUND/.test(response)) done({ status: "INFECTED", detail: response.replace(/\0/g, "").trim() });
      else done({ status: "FAILED", detail: response.trim() });
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const chunk = 64 * 1024;
      for (let i = 0; i < buf.length; i += chunk) {
        const part = buf.subarray(i, i + chunk);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

const SIGNATURES: { mime: string; ext: string[]; test: (b: Buffer) => boolean }[] = [
  { mime: "application/pdf", ext: ["pdf"], test: (b) => b.subarray(0, 5).toString() === "%PDF-" },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: ["docx"],
    test: (b) => b[0] === 0x50 && b[1] === 0x4b && b.includes(Buffer.from("word/")),
  },
  { mime: "text/plain", ext: ["txt", "md"], test: (b) => !b.subarray(0, 4096).includes(0) },
  { mime: "audio/webm", ext: ["webm"], test: (b) => b.readUInt32BE(0) === 0x1a45dfa3 },
  { mime: "audio/ogg", ext: ["ogg"], test: (b) => b.subarray(0, 4).toString() === "OggS" },
  { mime: "audio/wav", ext: ["wav"], test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WAVE" },
  { mime: "audio/mp4", ext: ["m4a", "mp4"], test: (b) => b.subarray(4, 8).toString() === "ftyp" },
  { mime: "audio/mpeg", ext: ["mp3"], test: (b) => b.subarray(0, 3).toString() === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { mime: "image/png", ext: ["png"], test: (b) => b.readUInt32BE(0) === 0x89504e47 },
  { mime: "image/jpeg", ext: ["jpg", "jpeg"], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

/**
 * Determine the real content type from magic bytes (never trust the
 * client-supplied MIME or extension). Returns null if not an allowed type.
 */
export function sniffType(buf: Buffer, allowed: string[]): string | null {
  if (buf.length < 8) return null;
  for (const sig of SIGNATURES) {
    if (allowed.includes(sig.mime) && sig.test(buf)) return sig.mime;
  }
  return null;
}

export const RESUME_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
export const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/wav", "audio/mp4", "audio/mpeg"];
export const IMAGE_TYPES = ["image/png", "image/jpeg"];
