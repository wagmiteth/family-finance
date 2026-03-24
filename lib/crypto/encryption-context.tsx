"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  deriveKEK,
  unwrapDEK,
  encryptData,
  decryptData,
  fromBase64,
  toBase64,
} from "./client-crypto";
import {
  getDEK,
  setDEK,
  clearDEK,
  restoreDEK,
} from "./key-store";

interface EncryptionContextValue {
  /** Whether the DEK is available and data can be encrypted/decrypted */
  isUnlocked: boolean;
  /** Whether we're still trying to restore the DEK from sessionStorage */
  isRestoring: boolean;
  /** Whether the user has key material (false = legacy user, no encryption) */
  hasKeyMaterial: boolean;
  /** Derive KEK from password, unwrap DEK, store in session */
  unlock: (password: string) => Promise<void>;
  /** Clear the DEK (on logout) */
  lock: () => void;
  /** Encrypt a plaintext string. Returns base64-encoded cipherblob. */
  encrypt: (plaintext: string) => Promise<string>;
  /** Decrypt a base64-encoded cipherblob. Returns plaintext string. */
  decrypt: (ciphertextBase64: string) => Promise<string>;
}

const EncryptionContext = createContext<EncryptionContextValue | null>(null);

export function EncryptionProvider({ children }: { children: ReactNode }) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [hasKeyMaterial, setHasKeyMaterial] = useState(false);

  // Try to restore DEK from sessionStorage on mount
  useEffect(() => {
    restoreDEK().then((restored) => {
      setIsUnlocked(restored);
      if (restored) {
        setHasKeyMaterial(true);
      }
      setIsRestoring(false);
    });
  }, []);

  // Check if user has key material (only when not restored from session)
  useEffect(() => {
    if (isRestoring || isUnlocked) return;

    fetch("/api/user/key-material")
      .then((res) => {
        setHasKeyMaterial(res.ok);
      })
      .catch(() => {
        setHasKeyMaterial(false);
      });
  }, [isRestoring, isUnlocked]);

  const unlock = useCallback(async (password: string) => {
    // Fetch key material from API
    const res = await fetch("/api/user/key-material");
    if (!res.ok) {
      throw new Error("No key material found. Complete onboarding first.");
    }

    const { salt, iterations, wrapped_dek } = await res.json();

    // Derive KEK from password
    const saltBytes = fromBase64(salt);
    const kek = await deriveKEK(password, saltBytes, iterations);

    // Unwrap DEK
    const wrappedBytes = fromBase64(wrapped_dek);
    const dek = await unwrapDEK(wrappedBytes.buffer as ArrayBuffer, kek);

    // Store in session
    await setDEK(dek);
    setIsUnlocked(true);
    setHasKeyMaterial(true);
  }, []);

  const lock = useCallback(() => {
    clearDEK();
    setIsUnlocked(false);
  }, []);

  const encrypt = useCallback(async (plaintext: string): Promise<string> => {
    const dek = getDEK();
    if (!dek) throw new Error("Encryption not unlocked");
    const blob = await encryptData(plaintext, dek);
    return toBase64(blob);
  }, []);

  const decrypt = useCallback(async (ciphertextBase64: string): Promise<string> => {
    const dek = getDEK();
    if (!dek) throw new Error("Encryption not unlocked");
    const blob = fromBase64(ciphertextBase64);
    return decryptData(blob, dek);
  }, []);

  return (
    <EncryptionContext.Provider
      value={{ isUnlocked, isRestoring, hasKeyMaterial, unlock, lock, encrypt, decrypt }}
    >
      {children}
    </EncryptionContext.Provider>
  );
}

export function useEncryption(): EncryptionContextValue {
  const context = useContext(EncryptionContext);
  if (!context) {
    throw new Error("useEncryption must be used within EncryptionProvider");
  }
  return context;
}
