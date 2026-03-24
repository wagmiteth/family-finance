/**
 * Core client-side cryptography using the Web Crypto API.
 *
 * Architecture:
 *   Password → PBKDF2 → KEK (AES-KW)
 *   KEK wraps/unwraps → DEK (AES-GCM 256-bit)
 *   DEK encrypts/decrypts → sensitive transaction data
 *
 * The server never sees the DEK or plaintext sensitive data.
 */

const KDF_ITERATIONS = 600_000; // OWASP 2023 recommendation for PBKDF2-SHA256

/** Generate a random 32-byte salt */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Derive a Key Encryption Key (KEK) from a password + salt using PBKDF2 */
export async function deriveKEK(
  password: string,
  salt: Uint8Array,
  iterations: number = KDF_ITERATIONS
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  );
}

/** Generate a random AES-GCM 256-bit Data Encryption Key (DEK) */
export async function generateDEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable — needed for wrapping and sessionStorage
    ["encrypt", "decrypt"]
  );
}

/** Wrap (encrypt) the DEK with a KEK using AES-KW */
export async function wrapDEK(
  dek: CryptoKey,
  kek: CryptoKey
): Promise<ArrayBuffer> {
  return crypto.subtle.wrapKey("raw", dek, kek, "AES-KW");
}

/** Unwrap (decrypt) the DEK using a KEK */
export async function unwrapDEK(
  wrappedDek: ArrayBuffer,
  kek: CryptoKey
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    wrappedDek,
    kek,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}

/** Export DEK as raw bytes (for sessionStorage or key exchange) */
export async function exportDEK(dek: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("raw", dek);
}

/** Import DEK from raw bytes */
export async function importDEK(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt plaintext string with the DEK using AES-GCM.
 * Returns: [1 byte version][12 bytes IV][ciphertext+tag]
 */
export async function encryptData(
  plaintext: string,
  dek: CryptoKey
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    dek,
    encoder.encode(plaintext)
  );

  // version(1) + iv(12) + ciphertext
  const result = new Uint8Array(1 + 12 + ciphertext.byteLength);
  result[0] = 1; // version byte
  result.set(iv, 1);
  result.set(new Uint8Array(ciphertext), 13);
  return result;
}

/**
 * Decrypt a blob encrypted with encryptData().
 * Expects: [1 byte version][12 bytes IV][ciphertext+tag]
 */
export async function decryptData(
  blob: Uint8Array,
  dek: CryptoKey
): Promise<string> {
  const version = blob[0];
  if (version !== 1) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  const iv = blob.slice(1, 13);
  const ciphertext = blob.slice(13);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    dek,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

// --- Base64 helpers for transport ---

export function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export { KDF_ITERATIONS };
