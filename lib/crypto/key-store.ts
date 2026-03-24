/**
 * DEK session management.
 *
 * The DEK is held in memory and mirrored to sessionStorage (base64-encoded
 * raw key bytes) so it survives SPA navigations but is cleared when the
 * tab closes.
 *
 * Security note: sessionStorage is vulnerable to XSS, but so are the
 * Supabase session tokens already stored in cookies/localStorage. The
 * threat model here is protecting data at rest on the server, not
 * defending against a compromised browser.
 */

import { exportDEK, importDEK, toBase64, fromBase64 } from "./client-crypto";

const SESSION_KEY = "ff_dek";

let cachedDEK: CryptoKey | null = null;

export function getDEK(): CryptoKey | null {
  return cachedDEK;
}

export function hasDEK(): boolean {
  return cachedDEK !== null;
}

export async function setDEK(dek: CryptoKey): Promise<void> {
  cachedDEK = dek;
  try {
    const raw = await exportDEK(dek);
    sessionStorage.setItem(SESSION_KEY, toBase64(raw));
  } catch {
    // sessionStorage may not be available (SSR, private browsing)
  }
}

export function clearDEK(): void {
  cachedDEK = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** Try to restore the DEK from sessionStorage. Returns true if successful. */
export async function restoreDEK(): Promise<boolean> {
  if (cachedDEK) return true;

  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return false;

    const raw = fromBase64(stored);
    cachedDEK = await importDEK(raw.buffer as ArrayBuffer);
    return true;
  } catch {
    return false;
  }
}
