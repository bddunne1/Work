import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// OAuth tokens at rest. With TOKEN_ENCRYPTION_KEY set (64 hex chars = 32
// bytes; `openssl rand -hex 32`) they are AES-256-GCM encrypted; without it
// they are stored as-is and the status endpoint says so.

const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  return Buffer.from(hex, "hex");
}

export function secretsEncrypted(): boolean {
  return key() !== null;
}

export function seal(plain: string): string {
  const k = key();
  if (!k) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, body]).toString("base64");
}

export function open(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const k = key();
  if (!k) throw new Error("Stored token is encrypted but TOKEN_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const body = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
