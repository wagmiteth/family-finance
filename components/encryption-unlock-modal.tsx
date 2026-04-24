"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useEncryption } from "@/lib/crypto/encryption-context";
import { createClient } from "@/lib/supabase/client";
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
  const router = useRouter();
  const { isUnlocked, isRestoring, unlock, lock } = useEncryption();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

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

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      lock();
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
    } catch {
      toast.error("Could not log out. Please try again.");
      setLoggingOut(false);
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
              disabled={loading || loggingOut}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={loading || loggingOut}
          >
            {loading ? "Unlocking..." : "Unlock"}
          </Button>
        </form>
        <div className="pt-2 text-center text-xs text-muted-foreground">
          Forgot your password or using the wrong account?{" "}
          <button
            type="button"
            onClick={handleLogout}
            disabled={loading || loggingOut}
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loggingOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
