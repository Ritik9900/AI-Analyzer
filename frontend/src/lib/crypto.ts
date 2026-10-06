import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for secrets at rest. Payload: base64(iv):base64(tag):base64(ciphertext)

export class ConfigError extends Error {}

function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new ConfigError("APP_SECRET is not set in frontend/.env (see README, step 6).");
  }
  const buf = Buffer.from(secret, "base64");
  if (buf.length !== 32) {
    throw new ConfigError("APP_SECRET must be 32 bytes, base64-encoded (see README, step 6).");
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64")).join(":");
}

export function decrypt(payload: string): string {
  const [iv, tag, ciphertext] = payload.split(":").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !ciphertext) throw new Error("Malformed encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
