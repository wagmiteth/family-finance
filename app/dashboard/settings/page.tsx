"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Plus,
  Trash2,
  Pencil,
  Key,
  TestTube,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type {
  User,
  Household,
  Category,
  MerchantRule,
  Transaction,
} from "@/lib/types";
import { useDecryptedFetch } from "@/lib/crypto/use-decrypted-fetch";
import { decryptEntity, decryptEntities, encryptCategory, encryptMerchantRule } from "@/lib/crypto/entity-crypto";
import { getDEK } from "@/lib/crypto/key-store";
import { InviteBanner } from "@/components/invite-banner";

export default function SettingsPageWrapper() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}

function SettingsPage() {
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get("tab") || "household";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="household">Household</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="rules">Merchant Rules</TabsTrigger>
          <TabsTrigger value="apikey">API Key</TabsTrigger>
        </TabsList>

        <TabsContent value="household">
          <HouseholdTab />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesTab />
        </TabsContent>
        <TabsContent value="rules">
          <MerchantRulesTab />
        </TabsContent>
        <TabsContent value="apikey">
          <ApiKeyTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Household Tab ---
function HouseholdTab() {
  const [user, setUser] = useState<User | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  useEffect(() => {
    async function fetchData() {
      const [userRes, householdRes] = await Promise.all([
        fetch("/api/user"),
        fetch("/api/household"),
      ]);

      const dek = getDEK();
      if (userRes.ok) {
        const raw = await userRes.json();
        const decrypted = await decryptEntity(raw, dek);
        setUser(decrypted as unknown as User);
      }
      if (householdRes.ok) {
        const data = await householdRes.json();
        const decryptedHousehold = await decryptEntity(data.household, dek);
        setHousehold(decryptedHousehold as unknown as Household);
        const decryptedMembers = await decryptEntities(data.members || [], dek);
        setMembers(decryptedMembers as unknown as User[]);
      }
    }
    fetchData();
  }, []);

  return (
    <div className="space-y-6 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Household</CardTitle>
          <CardDescription>
            Your household information and invite code
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Household Name</Label>
            <p className="text-sm font-medium">{household?.name || "---"}</p>
          </div>

          {/* Members */}
          <div className="space-y-2">
            <Label>Members</Label>
            <div className="space-y-2">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <Avatar className="h-8 w-8">
                    {m.avatar_url ? (
                      <AvatarImage src={m.avatar_url} alt={m.name} />
                    ) : null}
                    <AvatarFallback className="text-sm font-medium text-muted-foreground">
                      {m.name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {m.name}
                      {m.id === user?.id && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          You
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {m.email}
                    </p>
                  </div>
                </div>
              ))}
              {members.length < 2 && (
                <p className="text-sm text-muted-foreground">
                  Waiting for partner to join...
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {members.length < 2 && household?.invite_code && (
        <InviteBanner inviteCode={household.invite_code} inviterName={user?.name} />
      )}
    </div>
  );
}

// --- Categories Tab ---
function CategoriesTab() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editSplitType, setEditSplitType] = useState<
    "equal" | "full_payer" | "none"
  >("equal");
  const [editSplitRatio, setEditSplitRatio] = useState(50);
  const [members, setMembers] = useState<User[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    const dek = getDEK();
    const [catRes, usersRes] = await Promise.all([
      fetch("/api/categories"),
      fetch("/api/users"),
    ]);
    if (catRes.ok) {
      const raw = await catRes.json();
      setCategories(await decryptEntities(raw, dek) as unknown as Category[]);
    }
    if (usersRes.ok) {
      const raw = await usersRes.json();
      setMembers(await decryptEntities(raw, dek) as unknown as User[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  function openEdit(cat: Category) {
    setEditCategory(cat);
    setEditDisplayName(cat.display_name);
    setEditColor(cat.color || "#6366f1");
    setEditSplitType(cat.split_type);
    setEditSplitRatio(cat.split_ratio ?? 50);
    setIsNew(false);
    setDialogOpen(true);
  }

  const defaultColors = [
    "#0ea5e9", "#3b82f6", "#8b5cf6", "#ec4899",
    "#ef4444", "#f97316", "#f59e0b", "#22c55e",
    "#14b8a6", "#6b7280", "#94a3b8", "#1e293b",
  ];

  function openNew() {
    setEditCategory(null);
    setEditDisplayName("");
    setEditColor(defaultColors[Math.floor(Math.random() * 8)]);
    setEditSplitType("equal");
    setEditSplitRatio(50);
    setIsNew(true);
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const catData = {
        display_name: editDisplayName,
        name: editDisplayName.toLowerCase().replace(/\s+/g, "_"),
        color: editColor,
        split_type: editSplitType,
        split_ratio: editSplitType === "equal" ? editSplitRatio : 50,
        description: editCategory?.description ?? null,
      };
      const encrypted_data = await encryptCategory(catData);

      if (isNew) {
        const res = await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ encrypted_data }),
        });
        if (res.ok) {
          toast.success("Category created");
          fetchCategories();
        } else {
          toast.error("Failed to create category");
        }
      } else if (editCategory) {
        const res = await fetch("/api/categories", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editCategory.id,
            encrypted_data,
            owner_user_id: editCategory.owner_user_id,
          }),
        });
        if (res.ok) {
          toast.success("Category updated");
          fetchCategories();
        } else {
          toast.error("Failed to update category");
        }
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
      setDialogOpen(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/categories?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Category deleted");
        fetchCategories();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete category");
      }
    } catch {
      toast.error("Failed to delete category");
    }
  }

  async function handleMoveCategory(index: number, direction: "up" | "down") {
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= categories.length) return;

    setReordering(true);
    const newCategories = [...categories];
    [newCategories[index], newCategories[swapIndex]] = [
      newCategories[swapIndex],
      newCategories[index],
    ];

    setCategories(newCategories);

    const orderPayload = newCategories.map((c, i) => ({
      id: c.id,
      sort_order: i,
    }));

    try {
      const res = await fetch("/api/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: orderPayload }),
      });
      if (!res.ok) {
        toast.error("Failed to reorder categories");
        fetchCategories();
      }
    } catch {
      toast.error("Failed to reorder categories");
      fetchCategories();
    } finally {
      setReordering(false);
    }
  }

  if (loading) {
    return <p className="text-muted-foreground mt-4">Loading...</p>;
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Categories</h2>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" /> Add Category
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[70px]">Order</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Split Type</TableHead>
                <TableHead>System</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat, index) => (
                <TableRow key={cat.id}>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleMoveCategory(index, "up")}
                        disabled={index === 0 || reordering}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleMoveCategory(index, "down")}
                        disabled={
                          index === categories.length - 1 || reordering
                        }
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div
                      className="h-4 w-4 rounded-full border"
                      style={{
                        backgroundColor: cat.color || "#e5e7eb",
                      }}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {cat.display_name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {cat.split_type === "equal"
                        ? cat.split_ratio === 50
                          ? "Shared (50/50)"
                          : `Shared (${cat.split_ratio}/${100 - cat.split_ratio})`
                        : cat.split_type === "full_payer"
                          ? "Full payer"
                          : "None"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {cat.is_system ? (
                      <Badge variant="secondary" className="text-xs">
                        System
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(cat)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {!cat.is_system && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(cat.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit / Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isNew ? "Add Category" : "Edit Category"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="catName">Display Name</Label>
              <Input
                id="catName"
                placeholder="e.g. 🏠 Housing"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Tip: start with an emoji for quick recognition (e.g. 🍔 Food, 🚗 Transport)
              </p>
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {defaultColors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => setEditColor(c)}
                    className={`h-7 w-7 rounded-full border-2 transition-all ${
                      editColor === c
                        ? "border-foreground scale-110"
                        : "border-transparent hover:border-muted-foreground/40"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <label className="relative h-7 w-7 cursor-pointer">
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                  <div
                    className={`h-7 w-7 rounded-full border-2 border-dashed border-muted-foreground/40 flex items-center justify-center text-muted-foreground text-xs ${
                      !defaultColors.includes(editColor) ? "ring-2 ring-foreground ring-offset-1" : ""
                    }`}
                    style={
                      !defaultColors.includes(editColor)
                        ? { backgroundColor: editColor }
                        : undefined
                    }
                  >
                    {defaultColors.includes(editColor) && "+"}
                  </div>
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Split Type</Label>
              <Select
                value={editSplitType}
                onValueChange={(v) =>
                  setEditSplitType(v as "equal" | "full_payer" | "none")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="equal">Shared Split</SelectItem>
                  <SelectItem value="full_payer">Full Payer</SelectItem>
                  <SelectItem value="none">None (Personal)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editSplitType === "equal" && members.length >= 2 && (
              <div className="space-y-3">
                <Label>Split Ratio</Label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{members[0].name}</span>
                    <span className="font-medium">{members[1].name}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={99}
                    value={editSplitRatio}
                    onChange={(e) => setEditSplitRatio(Number(e.target.value))}
                    title="Split ratio"
                    aria-label="Split ratio"
                    className="w-full h-2 rounded-full appearance-none cursor-pointer accent-primary bg-muted"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono">{editSplitRatio}%</span>
                    <span className="font-mono">{100 - editSplitRatio}%</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !editDisplayName}>
              {saving ? "Saving..." : isNew ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deleted Transactions */}
      <DeletedTransactionsSection categories={categories} onRestore={fetchCategories} />
    </div>
  );
}

// --- Deleted Transactions Section ---
function DeletedTransactionsSection({
  categories,
  onRestore,
}: {
  categories: Category[];
  onRestore: () => void;
}) {
  const [deletedTx, setDeletedTx] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const fetchDecrypted = useDecryptedFetch();

  const deletedCategory = categories.find((c) => c.name === "deleted");
  const uncategorizedCategory = categories.find((c) => c.name === "uncategorized");

  const fetchDeleted = useCallback(async () => {
    if (!deletedCategory) return;
    setLoading(true);
    try {
      const allTx = await fetchDecrypted("/api/transactions") as Transaction[];
      setDeletedTx(allTx.filter((t) => t.category_id === deletedCategory.id));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [deletedCategory, fetchDecrypted]);

  useEffect(() => {
    fetchDeleted();
  }, [fetchDeleted]);

  async function handleRestore(tx: Transaction) {
    if (!uncategorizedCategory) return;
    setRestoring(tx.id);
    try {
      const res = await fetch(`/api/transactions/${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: uncategorizedCategory.id }),
      });
      if (res.ok) {
        setDeletedTx((prev) => prev.filter((t) => t.id !== tx.id));
        toast.success("Transaction restored to Uncategorized");
        onRestore();
      } else {
        toast.error("Failed to restore transaction");
      }
    } catch {
      toast.error("Failed to restore transaction");
    } finally {
      setRestoring(null);
    }
  }

  async function handlePermanentDelete(tx: Transaction) {
    setRestoring(tx.id);
    try {
      const res = await fetch(`/api/transactions/${tx.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDeletedTx((prev) => prev.filter((t) => t.id !== tx.id));
        toast.success("Transaction permanently deleted");
      } else {
        toast.error("Failed to delete transaction");
      }
    } catch {
      toast.error("Failed to delete transaction");
    } finally {
      setRestoring(null);
    }
  }

  if (!deletedCategory || deletedTx.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: deletedCategory.color || "#dc2626" }}
          />
          <CardTitle className="text-base">Deleted Transactions</CardTitle>
          <Badge variant="secondary" className="text-xs">{deletedTx.length}</Badge>
        </div>
        <CardDescription>
          These transactions have been removed. You can restore them or delete permanently.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-2">
            {deletedTx.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {tx.description || "[Encrypted]"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tx.date} &middot; {tx.amount.toLocaleString("sv-SE", { style: "currency", currency: "SEK", minimumFractionDigits: 0 })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={restoring === tx.id}
                  onClick={() => handleRestore(tx)}
                  className="shrink-0 gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={restoring === tx.id}
                  onClick={() => handlePermanentDelete(tx)}
                  className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Merchant Rules Tab ---
function MerchantRulesTab() {
  const [rules, setRules] = useState<MerchantRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editRule, setEditRule] = useState<MerchantRule | null>(null);
  const [editPattern, setEditPattern] = useState("");
  const [editCategoryId, setEditCategoryId] = useState<string>("");
  const [editMatchTransactionType, setEditMatchTransactionType] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const dek = getDEK();
    const [rulesRes, catsRes] = await Promise.all([
      fetch("/api/merchant-rules"),
      fetch("/api/categories"),
    ]);
    if (rulesRes.ok) {
      const raw = await rulesRes.json();
      setRules(await decryptEntities(raw, dek) as unknown as MerchantRule[]);
    }
    if (catsRes.ok) {
      const raw = await catsRes.json();
      setCategories(await decryptEntities(raw, dek) as unknown as Category[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function openEdit(rule: MerchantRule) {
    setEditRule(rule);
    setEditPattern(rule.pattern);
    setEditCategoryId(rule.category_id || "");
    setEditMatchTransactionType(rule.match_transaction_type || "");
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!editRule) return;
    setSaving(true);
    try {
      const ruleData = {
        pattern: editRule.rule_type === "auto_import" ? ".*" : editPattern,
        rule_type: editRule.rule_type,
        match_transaction_type: editRule.rule_type === "auto_import" ? (editMatchTransactionType || null) : null,
        merchant_name: editRule.merchant_name,
        merchant_type: editRule.merchant_type,
        amount_hint: editRule.amount_hint,
        amount_max: editRule.amount_max,
        notes: editRule.notes,
      };
      const encrypted_data = await encryptMerchantRule(ruleData);

      const res = await fetch("/api/merchant-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editRule.id,
          encrypted_data,
          category_id: editCategoryId || null,
        }),
      });
      if (res.ok) {
        toast.success("Rule updated");
        fetchData();
      } else {
        toast.error("Failed to update rule");
      }
    } catch {
      toast.error("Failed to update rule");
    } finally {
      setSaving(false);
      setDialogOpen(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/merchant-rules?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Rule deleted");
        fetchData();
      } else {
        toast.error("Failed to delete rule");
      }
    } catch {
      toast.error("Failed to delete rule");
    }
  }

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const autoImportRules = rules.filter((r) => r.rule_type === "auto_import");
  const patternRules = rules.filter((r) => r.rule_type === "pattern");

  if (loading) {
    return <p className="text-muted-foreground mt-4">Loading...</p>;
  }

  return (
    <div className="space-y-6 mt-4">
      {/* Auto-import Rules */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Auto-Import Rules</h2>
          <p className="text-sm text-muted-foreground">
            Applied automatically when transactions are imported. Match by transaction type.
          </p>
        </div>

        {autoImportRules.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <p className="text-sm text-muted-foreground">No auto-import rules</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When Transaction Type Is</TableHead>
                    <TableHead>Assign to Category</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {autoImportRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <Badge variant="secondary" className="text-sm capitalize">
                          {rule.match_transaction_type || "Any"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {rule.category_id
                          ? categoryMap.get(rule.category_id)?.display_name || "Unknown"
                          : "—"}
                      </TableCell>
                      <TableCell>{rule.priority}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(rule)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(rule.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Pattern Rules */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Pattern Rules</h2>
          <p className="text-sm text-muted-foreground">
            Match transactions by description. Run manually via &quot;Auto-sort&quot; on the transactions page, or learned when you drag-categorize.
          </p>
        </div>

        {patternRules.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <p className="text-sm text-muted-foreground">No pattern rules yet</p>
              <p className="text-xs text-muted-foreground">
                Rules are created when you categorize transactions
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description Pattern</TableHead>
                    <TableHead>Assign to Category</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patternRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-mono text-sm">
                        {rule.pattern}
                      </TableCell>
                      <TableCell>
                        {rule.category_id
                          ? categoryMap.get(rule.category_id)?.display_name || "Unknown"
                          : "—"}
                      </TableCell>
                      <TableCell>{rule.priority}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {rule.is_learned ? "Learned" : "Manual"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(rule)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(rule.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Edit Rule Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editRule?.rule_type === "auto_import"
                ? "Edit Auto-Import Rule"
                : "Edit Pattern Rule"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editRule?.rule_type === "auto_import" ? (
              <div className="space-y-2">
                <Label htmlFor="ruleTransactionType">Transaction Type</Label>
                <Input
                  id="ruleTransactionType"
                  value={editMatchTransactionType}
                  onChange={(e) => setEditMatchTransactionType(e.target.value)}
                  placeholder="e.g. transfer, withdrawal, deposit"
                />
                <p className="text-xs text-muted-foreground">
                  Transactions with this type will be automatically categorized during import
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="rulePattern">Description Pattern (regex or text)</Label>
                <Input
                  id="rulePattern"
                  value={editPattern}
                  onChange={(e) => setEditPattern(e.target.value)}
                  className="font-mono"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={editCategoryId}
                onValueChange={(v) => setEditCategoryId(v || "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category">
                    {editCategoryId
                      ? categoryMap.get(editCategoryId)?.display_name || "Select category"
                      : "Select category"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                saving ||
                (editRule?.rule_type === "auto_import" ? !editMatchTransactionType : !editPattern)
              }
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- API Key Tab ---
function ApiKeyTab() {
  const [apiKey, setApiKey] = useState("");
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function loadKey() {
      const res = await fetch("/api/user/settings");
      if (res.ok) {
        const data = await res.json();
        if (data.has_api_key && data.masked_api_key) {
          setMaskedKey(data.masked_api_key);
        }
      }
      setLoaded(true);
    }
    loadKey();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anthropic_api_key: apiKey.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success("API key saved");
        setApiKey("");
        setMaskedKey(data.has_api_key ? "sk-ant-••••" : null);
      } else {
        toast.error("Failed to save API key");
      }
    } catch {
      toast.error("Failed to save API key");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      });
      if (res.ok) {
        toast.success("API key is valid and working");
      } else {
        const data = await res.json();
        toast.error(data.error || "API key test failed");
      }
    } catch {
      toast.error("Failed to test API key");
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anthropic_api_key: null }),
      });
      if (res.ok) {
        toast.success("API key deleted");
        setApiKey("");
        setMaskedKey(null);
      } else {
        toast.error("Failed to delete API key");
      }
    } catch {
      toast.error("Failed to delete API key");
    } finally {
      setDeleting(false);
    }
  }

  if (!loaded) {
    return <p className="text-muted-foreground mt-4">Loading...</p>;
  }

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Anthropic API Key
          </CardTitle>
          <CardDescription>
            Used for AI-powered transaction enrichment and categorization
          </CardDescription>
          <div className="mt-2 flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              <strong>Privacy notice:</strong> Your API key is stored server-side and sent to Anthropic for transaction enrichment. Transaction descriptions are temporarily decrypted and sent to the Anthropic API during enrichment. This is an exception to the zero-knowledge model — if you prefer full privacy, do not use this feature.
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            {maskedKey && !apiKey && (
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground font-mono">
                  Current key: {maskedKey}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              </div>
            )}
            <Input
              id="apiKey"
              type="password"
              placeholder={maskedKey ? "Enter new key to replace..." : "sk-ant-..."}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value.replace(/\s/g, ""))}
              className="font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Key"}
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || (!apiKey && !maskedKey)}
            >
              <TestTube className="mr-1 h-4 w-4" />
              {testing ? "Testing..." : "Test Connection"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
