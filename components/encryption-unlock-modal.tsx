"use client";

import { useState } from "react";
import { useEncryption } from "@/lib/crypto/encryption-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function EncryptionUnlockModal() {
  const { isUnlocked, isRestoring, unlock } = useEncryption();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Don't show if still restoring or already unlocked
  if (isRestoring || isUnlocked) return null;

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await unlock(password);
      setPassword("");
    } catch {
      toast.error(
        "Could not unlock. Check your password and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={true}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Unlock your data</DialogTitle>
          <DialogDescription>
            Your financial data is encrypted with your password. Enter your
            password to decrypt and view your transactions.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleUnlock} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="unlock-password">Password</Label>
            <Input
              id="unlock-password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Unlocking..." : "Unlock"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
