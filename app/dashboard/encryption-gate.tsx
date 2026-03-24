"use client";

import { type ReactNode } from "react";
import { useEncryption } from "@/lib/crypto/encryption-context";
import { EncryptionUnlockModal } from "@/components/encryption-unlock-modal";

/**
 * Wraps dashboard children with the unlock modal.
 * Only shows the unlock prompt if the user has key material
 * (i.e. they set up client-side encryption) but the DEK
 * is not currently in session.
 *
 * Legacy users (no key material) see no modal — their data
 * is decrypted server-side (encryption_version = 0).
 */
export function EncryptionGate({ children }: { children: ReactNode }) {
  const { isUnlocked, isRestoring, hasKeyMaterial } = useEncryption();

  const needsUnlock = !isRestoring && !isUnlocked && hasKeyMaterial;

  return (
    <>
      {needsUnlock && <EncryptionUnlockModal />}
      {children}
    </>
  );
}
