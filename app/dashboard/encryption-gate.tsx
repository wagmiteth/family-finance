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
 * Users without key material see no modal — they need to
 * set up encryption first.
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
