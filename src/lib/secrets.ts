// AES-256-GCM encryption for connector tokens persisted to HydraDB.
// Key derived from AUTH_SECRET so rotation is a single env-var change.
//
// Threat model: HydraDB recall returns memory `text` to the LLM and the UI;
// if user-supplied tokens are stored in plaintext there, any recall query
// scoped to the same tenant could surface them. By storing only ciphertext
// in metadata (and a sanitized label in text), recall never includes the
// secret, and even a HydraDB compromise yields ciphertext.
//
// Format: `v1:<iv_base64>:<ciphertext_base64>:<tag_base64>`
// Versioned so we can change algorithm later without breaking decryption.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSecret } from "./session";

function deriveKey(): Buffer {
  // SHA-256 gives a deterministic 32-byte key from any-length secret.
  return createHash("sha256").update(getSecret()).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12); // GCM standard nonce length
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptSecret(blob: string): string | null {
  try {
    const [v, ivB64, ctB64, tagB64] = blob.split(":");
    if (v !== "v1") return null;
    const key = deriveKey();
    const iv = Buffer.from(ivB64, "base64");
    const ct = Buffer.from(ctB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    // Tag mismatch (tampered) or malformed blob → return null, caller handles.
    return null;
  }
}

// Convenience: return a redacted token suitable for UI display.
// Keeps the first 4 chars + last 4, masks middle. Never reveals more than
// 8 chars total even for very short tokens.
export function redactToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "*".repeat(token.length);
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
