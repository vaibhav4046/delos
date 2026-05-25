// AES-256-GCM wrapper used by the BYOK key bag. Server-only. Derives the
// data key from DELRIO_SECRET so the same secret that signs sessions also
// encrypts third-party LLM provider keys. Plaintext keys never leave this
// file: they're decrypted just-in-time inside the orchestrator and the
// API response shape always reports `{ hasKey: true }` instead of the
// actual key material.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSecret } from "./session";

function derivedKey(): Buffer {
  // DELRIO_SECRET overrides AUTH_SECRET when present (rotation aid). Falls back
  // to the centralized getSecret(), which throws in production if unset.
  const s = process.env.DELRIO_SECRET || getSecret();
  // 32 bytes for AES-256.
  return createHash("sha256").update("delos:bag:v1:" + s).digest();
}

/** Encrypt → returns a versioned, base64url-encoded blob with IV + tag. */
export function encryptBag(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // v1:<iv>:<ct>:<tag>  — all base64url, separated by '.' so the blob is
  // safe to drop into URLs or storage keys.
  return [
    "v1",
    iv.toString("base64url"),
    ct.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

/** Decrypt → throws on tamper / bad version. */
export function decryptBag(blob: string): string {
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("invalid_bag_format");
  }
  const iv = Buffer.from(parts[1], "base64url");
  const ct = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", derivedKey(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
