"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEncryption } from "@/lib/crypto/encryption-context";
import { useDecryptedFetch } from "@/lib/crypto/use-decrypted-fetch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Download, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { User, Transaction } from "@/lib/types";

export default function AccountPage() {
  const router = useRouter();
  const supabase = createClient();
  const { lock } = useEncryption();
  const fetchDecrypted = useDecryptedFetch();

  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Password change
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // Delete account
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Export
  const [exporting, setExporting] = useState(false);

  const fetchProfile = useCallback(async () => {
    const res = await fetch("/api/user");
    if (res.ok) {
      const data = await res.json();
      setUser(data);
      setName(data.name || "");
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  async function handleSaveName() {
    setSaving(true);
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const updated = await res.json();
        setUser(updated);
        toast.success("Name updated");
      } else {
        toast.error("Failed to update name");
      }
    } catch {
      toast.error("Failed to update name");
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch("/api/user/avatar", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        router.refresh();
        toast.success("Avatar updated");
      } else {
        toast.error("Failed to upload avatar");
      }
    } catch {
      toast.error("Failed to upload avatar");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleChangePassword() {
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success(
          "Password updated. Remember: this is also your encryption key."
        );
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      toast.error("Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      // Fetch all transactions (mixed v0/v1)
      const data = await fetchDecrypted("/api/transactions");
      const transactions = data as Transaction[];

      if (transactions.length === 0) {
        toast.error("No transactions to export");
        return;
      }

      // Build CSV
      const headers = [
        "date",
        "description",
        "amount",
        "category_id",
        "user_id",
        "transaction_type",
        "bank_name",
        "account_number",
        "account_name",
        "notes",
        "enriched_name",
        "enriched_info",
      ];
      const rows = transactions.map((t) =>
        headers
          .map((h) => {
            const val = (t as unknown as Record<string, unknown>)[h];
            if (val === null || val === undefined) return "";
            const str = String(val);
            // Escape CSV
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(",")
      );

      const csv = [headers.join(","), ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `family-finance-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${transactions.length} transactions`);
    } catch {
      toast.error("Failed to export data");
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE") return;
    setDeleting(true);
    try {
      const res = await fetch("/api/user/delete", { method: "DELETE" });
      if (res.ok) {
        lock();
        await supabase.auth.signOut();
        router.push("/login");
      } else {
        toast.error("Failed to delete account");
      }
    } catch {
      toast.error("Failed to delete account");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Account</h1>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Avatar className="h-20 w-20 border-2 border-border">
                {user?.avatar_url ? (
                  <AvatarImage src={user.avatar_url} alt={user.name} />
                ) : null}
                <AvatarFallback className="text-2xl font-semibold text-muted-foreground">
                  {user?.name?.charAt(0)?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <label
                htmlFor="avatar-upload"
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                {uploading ? "..." : "Change"}
              </label>
              <input
                id="avatar-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatarUpload}
                disabled={uploading}
              />
            </div>
            <div>
              <p className="text-sm font-medium">{user?.name || "---"}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click avatar to change (max 2MB)
              </p>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="profileName">Display Name</Label>
            <Input
              id="profileName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <Button
            onClick={handleSaveName}
            disabled={saving || name === user?.name}
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>
            Your password is also your encryption key. All your financial data
            is encrypted with it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            <strong>Warning:</strong> Changing your password will not
            re-encrypt existing data automatically. If you have client-side
            encrypted data, you may need to re-wrap your encryption keys.
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
              minLength={6}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
            />
          </div>
          <Button
            onClick={handleChangePassword}
            disabled={changingPassword || !newPassword || !confirmPassword}
          >
            {changingPassword ? "Changing..." : "Change Password"}
          </Button>
        </CardContent>
      </Card>

      {/* Export Data */}
      <Card>
        <CardHeader>
          <CardTitle>Export Data</CardTitle>
          <CardDescription>
            Download all your transactions as a CSV file
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Exporting..." : "Export to CSV"}
          </Button>
        </CardContent>
      </Card>

      {/* Delete Account */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Permanently delete your account and all associated data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Account
          </Button>
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Account
            </DialogTitle>
            <DialogDescription>
              This action is permanent and cannot be undone. All your
              transactions, settings, and encryption keys will be deleted.
              Your household partner will lose access to your shared data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="deleteConfirm">
              Type <strong>DELETE</strong> to confirm
            </Label>
            <Input
              id="deleteConfirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={deleteConfirm !== "DELETE" || deleting}
            >
              {deleting ? "Deleting..." : "Permanently Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
