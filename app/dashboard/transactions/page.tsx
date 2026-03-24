"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  format,
  startOfMonth,
  addMonths,
  subMonths,
} from "date-fns";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Loader2,
  GripVertical,
  Wand2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { Transaction, Category, User, MerchantRule } from "@/lib/types";
import { useDecryptedFetch } from "@/lib/crypto/use-decrypted-fetch";

function formatCurrency(amount: number) {
  return Math.abs(amount).toLocaleString("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// ─── Draggable Transaction Card ──────────────────────────────────────────────

function TransactionCard({
  transaction,
  categories,
  users,
  isSelected,
  isMultiDragSource,
  selectedCount,
  onToggleSelect,
  onClickDetail,
  onChangeUser,
  onChangeCategory,
}: {
  transaction: Transaction;
  categories: Category[];
  users: User[];
  isSelected: boolean;
  isMultiDragSource: boolean;
  selectedCount: number;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onClickDetail: (t: Transaction) => void;
  onChangeUser: (userId: string) => void;
  onChangeCategory: (categoryId: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: transaction.id,
  });

  const user = users.find((u) => u.id === transaction.user_id);
  const userIndex = users.findIndex((u) => u.id === transaction.user_id);
  const userColor = userIndex === 0 ? "border-primary text-primary" : "border-warm text-warm";
  const category = categories.find((c) => c.id === transaction.category_id);

  const isHidden = isDragging || isMultiDragSource;
  const bulkLabel = isSelected && selectedCount > 1 ? ` (${selectedCount})` : "";

  const uncategorizedCat = categories.find((c) => c.name === "uncategorized");
  const displayCategory = category || uncategorizedCat;

  return (
    <div
      ref={setNodeRef}
      className={`flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm select-none transition-all duration-200 ${
        isHidden
          ? "opacity-0 h-0 p-0 m-0 border-0 overflow-hidden"
          : "cursor-grab active:cursor-grabbing hover:shadow-md shadow-sm"
      } ${isSelected && !isHidden ? "ring-2 ring-primary border-primary" : ""}`}
      {...attributes}
      {...listeners}
    >
      {/* Checkbox */}
      <div onPointerDown={(e) => e.stopPropagation()} className="pt-1">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect(transaction.id, false)}
          onClick={(e: React.MouseEvent) => {
            if (e.shiftKey) {
              e.preventDefault();
              onToggleSelect(transaction.id, true);
            }
          }}
        />
      </div>

      {/* Payer avatar */}
      <div onPointerDown={(e) => e.stopPropagation()} className="pt-0.5">
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                title={`Payer: ${user?.name || "?"}`}
                className={`rounded-full ring-2 ring-offset-1 transition-colors hover:ring-offset-2 ${userIndex === 0 ? "ring-primary" : "ring-warm"}`}
              >
                <Avatar className="h-7 w-7">
                  {user?.avatar_url && <AvatarImage src={user.avatar_url} />}
                  <AvatarFallback className="text-[10px] font-semibold">
                    {user?.name?.[0]?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
              </button>
            }
          />
          <PopoverContent className="w-36 p-1" align="start">
            <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Payer{bulkLabel}
            </p>
            {users.map((u, i) => (
              <button
                key={u.id}
                type="button"
                onClick={() => onChangeUser(u.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors ${
                  u.id === transaction.user_id ? "bg-accent font-medium" : ""
                }`}
              >
                <Avatar className="h-4 w-4">
                  {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                  <AvatarFallback className="text-[7px]">{u.name?.[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                {u.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Row 1: Description + Amount */}
        <div className="flex items-baseline justify-between gap-2">
          <p
            className="text-sm font-medium leading-snug truncate cursor-pointer hover:underline"
            onClick={() => onClickDetail(transaction)}
          >
            {transaction.enriched_name || transaction.description}
          </p>
          <span className={`text-xs font-mono shrink-0 ${transaction.amount >= 0 ? "text-green-600" : "text-muted-foreground"}`}>
            {transaction.amount >= 0 ? "+" : ""}{formatCurrency(transaction.amount)}
          </span>
        </div>

        {/* Row 2: Date + enrichment | Category */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              {format(new Date(transaction.date), "MMM d")}
            </span>
            {transaction.enriched_at && (
              <Sparkles className="h-3 w-3 text-amber-500" />
            )}
          </div>

          {/* Category badge */}
          <div onPointerDown={(e) => e.stopPropagation()}>
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    title="Change category"
                    className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0 h-[18px] text-[10px] font-medium transition-colors hover:bg-accent text-muted-foreground"
                  >
                    {displayCategory?.color && (
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: displayCategory.color }}
                      />
                    )}
                    {displayCategory?.display_name?.replace(/^[^\w\s]*\s*/, "").split(" ")[0] || "Uncategorized"}
                  </button>
                }
              />
              <PopoverContent className="w-44 p-1" align="end">
                <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Category{bulkLabel}
                </p>
                <ScrollArea className="max-h-48">
                  {categories
                    .filter((c) => c.name !== "deleted")
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onChangeCategory(c.id)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors ${
                          c.id === transaction.category_id ? "bg-accent font-medium" : ""
                        }`}
                      >
                        {c.color && (
                          <span
                            className="inline-block h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: c.color }}
                          />
                        )}
                        <span className="truncate">{c.display_name}</span>
                      </button>
                    ))}
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Drag Overlay ────────────────────────────────────────────────────────────

function TransactionCardOverlay({
  transaction,
  users,
  selectedCount,
}: {
  transaction: Transaction;
  users: User[];
  selectedCount: number;
}) {
  const user = users.find((u) => u.id === transaction.user_id);
  const userIndex = users.findIndex((u) => u.id === transaction.user_id);
  const userColor = userIndex === 0 ? "border-primary text-primary" : "border-warm text-warm";
  return (
    <div className="relative w-72 rotate-[1.5deg]">
      {selectedCount > 1 && (
        <div className="absolute -top-3 -right-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-lg ring-2 ring-background">
          {selectedCount}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm shadow-xl ring-1 ring-primary/20">
        <div className="flex-1 min-w-0">
          <p className="font-medium leading-snug truncate">
            {transaction.enriched_name || transaction.description}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-xs text-muted-foreground">
              {format(new Date(transaction.date), "MMM d")}
            </p>
            <span className="text-xs font-mono text-muted-foreground">
              {formatCurrency(transaction.amount)}
            </span>
            {user && (
              <Badge variant="outline" className={`text-[10px] px-1 py-0 h-4 ${userColor}`}>
                {user.name?.split(" ")[0] || "?"}
              </Badge>
            )}
          </div>
        </div>
      </div>
      {selectedCount > 1 && (
        <>
          <div className="absolute top-1 left-1 -z-10 w-full h-full rounded-lg border bg-muted/60 rotate-[-1deg]" />
          {selectedCount > 2 && (
            <div className="absolute top-2 left-2 -z-20 w-full h-full rounded-lg border bg-muted/40 rotate-[-2deg]" />
          )}
        </>
      )}
    </div>
  );
}

// ─── Droppable Category Column ───────────────────────────────────────────────

function CategoryColumn({
  category,
  categories,
  transactions,
  users,
  selectedIds,
  activeId,
  activeDragIds,
  isOverThis,
  isUncategorized,
  autoSorting,
  onToggleSelect,
  onClickDetail,
  onAutoSort,
  onChangeUser,
  onChangeCategory,
}: {
  category: { id: string; display_name: string; color: string | null };
  categories: Category[];
  transactions: Transaction[];
  users: User[];
  selectedIds: Set<string>;
  activeId: string | null;
  activeDragIds: Set<string>;
  isOverThis: boolean;
  isUncategorized: boolean;
  autoSorting: boolean;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onClickDetail: (t: Transaction) => void;
  onAutoSort: () => void;
  onChangeUser: (transactionId: string, userId: string) => void;
  onChangeCategory: (transactionId: string, categoryId: string | null) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: `col:${category.id}` });

  const { setNodeRef: setDroppableRef } = useDroppable({ id: `column:${category.id}` });

  const highlighted = isOverThis;
  const total = transactions.reduce((s, t) => s + Math.abs(t.amount), 0);

  // Count visible cards (exclude ones being dragged away)
  const visibleCount = transactions.filter((t) => !activeDragIds.has(t.id)).length;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={(node) => {
        setSortableRef(node);
        setDroppableRef(node);
      }}
      style={style}
      className={`flex w-72 shrink-0 flex-col rounded-xl border transition-shadow duration-200 ${
        isSortableDragging ? "opacity-40 shadow-lg z-50" : ""
      } ${
        highlighted
          ? "ring-2 ring-primary bg-primary/5 border-primary/30 scale-[1.01]"
          : "bg-muted/30"
      }`}
    >
      {/* Drag handle area */}
      <div
        className="flex items-center justify-center py-1 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>

      <div className="flex items-center justify-between border-b border-t px-3 py-2">
        <div className="flex items-center gap-2">
          {category.color && (
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: category.color }}
            />
          )}
          <h3 className="font-medium text-sm">{category.display_name}</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isUncategorized && transactions.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onAutoSort}
              disabled={autoSorting}
              title="Auto-sort using merchant rules"
            >
              {autoSorting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          <span>{formatCurrency(total)}</span>
          <span>·</span>
          <span>{visibleCount} txns</span>
        </div>
      </div>
      <ScrollArea className="flex-1 p-2" style={{ maxHeight: "calc(100vh - 280px)" }}>
        <div className="flex flex-col gap-2">
          {transactions.map((t) => (
            <TransactionCard
              key={t.id}
              transaction={t}
              categories={categories}
              users={users}
              isSelected={selectedIds.has(t.id)}
              isMultiDragSource={activeId !== null && activeId !== t.id && activeDragIds.has(t.id)}
              selectedCount={selectedIds.has(t.id) ? selectedIds.size : 1}
              onToggleSelect={onToggleSelect}
              onClickDetail={onClickDetail}
              onChangeUser={(userId) => onChangeUser(t.id, userId)}
              onChangeCategory={(catId) => onChangeCategory(t.id, catId)}
            />
          ))}
          {transactions.length === 0 && (
            <p className={`p-4 text-center text-xs transition-colors duration-200 ${
              highlighted ? "text-primary font-medium" : "text-muted-foreground"
            }`}>
              {highlighted ? "Drop here" : "Drop transactions here"}
            </p>
          )}
          {highlighted && transactions.length > 0 && (
            <div className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-3 text-center text-xs text-primary font-medium animate-pulse">
              Drop here
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Detail Components ───────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  );
}

function TransactionDetailDialog({
  transaction,
  categories,
  users,
  enriching,
  onClose,
  onEnrich,
  onUpdate,
  onDelete,
}: {
  transaction: Transaction | null;
  categories: Category[];
  users: User[];
  enriching: boolean;
  onClose: () => void;
  onEnrich: (t: Transaction) => void;
  onUpdate: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");

  useEffect(() => {
    if (transaction) {
      setNotes(transaction.notes || "");
      setSelectedCategoryId(transaction.category_id || "");
      setEditingNotes(false);
    }
  }, [transaction]);

  if (!transaction) return null;

  const user = users.find((u) => u.id === transaction.user_id);
  const userIndex = users.findIndex((u) => u.id === transaction.user_id);
  const userColor = userIndex === 0 ? "border-primary text-primary" : "border-warm text-warm";

  async function handleSaveNotes() {
    if (!transaction) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdate(updated);
        setEditingNotes(false);
        toast.success("Notes saved");
      }
    } catch {
      toast.error("Failed to save notes");
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleCategoryChange(catId: string) {
    if (!transaction) return;
    setSelectedCategoryId(catId);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: catId || null }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdate(updated);
        toast.success("Category updated");
      }
    } catch {
      toast.error("Failed to update category");
    }
  }

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg pr-6">
            {transaction.enriched_name || transaction.description}
          </DialogTitle>
          {transaction.enriched_name && transaction.enriched_name !== transaction.description && (
            <DialogDescription className="font-mono text-xs">
              {transaction.description}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* Amount + Date */}
          <div className="flex items-center justify-between rounded-lg bg-muted/50 p-4">
            <div>
              <p className="text-2xl font-bold font-mono">
                {formatCurrency(transaction.amount)}
              </p>
              <p className="text-sm text-muted-foreground">
                {format(new Date(transaction.date), "EEEE, MMMM d, yyyy")}
              </p>
            </div>
            {transaction.transaction_type && (
              <Badge variant="secondary">{transaction.transaction_type}</Badge>
            )}
          </div>

          {/* Enrichment section */}
          {transaction.enriched_at ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2 dark:border-amber-900 dark:bg-amber-950/30">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                <Sparkles className="h-4 w-4" />
                AI Enriched
              </div>
              <div className="space-y-1">
                <DetailRow label="Merchant" value={transaction.enriched_name} />
                <DetailRow label="Type" value={transaction.enriched_info} />
                {transaction.enriched_description && (
                  <div className="py-1">
                    <p className="text-xs font-medium text-muted-foreground">About</p>
                    <p className="text-sm">{transaction.enriched_description}</p>
                  </div>
                )}
                <DetailRow label="Address" value={transaction.enriched_address} />
              </div>
              <p className="text-xs text-muted-foreground">
                Enriched {format(new Date(transaction.enriched_at), "MMM d, yyyy HH:mm")}
              </p>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => onEnrich(transaction)}
              disabled={enriching}
            >
              {enriching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enriching with AI...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Enrich with AI
                </>
              )}
            </Button>
          )}

          <Separator />

          {/* Details */}
          <div className="space-y-2">
            <DetailRow label="User" value={user?.name} />
            <DetailRow
              label="Category"
              value={
                <select
                  value={selectedCategoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name}
                    </option>
                  ))}
                </select>
              }
            />
            <DetailRow label="Subcategory" value={transaction.subcategory} />
            <DetailRow
              label="Tags"
              value={
                transaction.tags && transaction.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {transaction.tags.map((tag, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null
              }
            />
          </div>

          {/* Bank info */}
          {(transaction.bank_name || transaction.account_number || transaction.account_name) && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Bank Details
                </p>
                <DetailRow label="Bank" value={transaction.bank_name} />
                <DetailRow label="Account" value={transaction.account_name} />
                <DetailRow label="Account #" value={transaction.account_number} />
              </div>
            </>
          )}

          {/* Notes */}
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Notes
              </p>
              {!editingNotes && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6"
                  onClick={() => setEditingNotes(true)}
                >
                  {transaction.notes ? "Edit" : "Add note"}
                </Button>
              )}
            </div>
            {editingNotes ? (
              <div className="space-y-2">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Add a note..."
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveNotes} disabled={savingNotes}>
                    {savingNotes ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingNotes(false);
                      setNotes(transaction.notes || "");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {transaction.notes || "No notes"}
              </p>
            )}
          </div>

          {/* Metadata */}
          <Separator />
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Created: {format(new Date(transaction.created_at), "MMM d, yyyy HH:mm")}</p>
              {transaction.updated_at !== transaction.created_at && (
                <p>Updated: {format(new Date(transaction.updated_at), "MMM d, yyyy HH:mm")}</p>
              )}
              <p className="font-mono text-[10px] opacity-50">ID: {transaction.id}</p>
            </div>
            {/* Delete button — disabled for now, soft-delete via category
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => onDelete(transaction)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
            */}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Custom collision detection: only target columns ─────────────────────────

function smartCollision(
  columnIds: Set<string>,
  sortableColumnIds: Set<string>,
  draggingColumnIdRef: React.RefObject<string | null>
): CollisionDetection {
  return (args) => {
    const isDraggingColumn = draggingColumnIdRef.current !== null;

    if (isDraggingColumn) {
      // When dragging a column, only collide with other sortable column items
      const sortableContainers = args.droppableContainers.filter((c) =>
        sortableColumnIds.has(String(c.id))
      );
      const pointer = pointerWithin({ ...args, droppableContainers: sortableContainers });
      if (pointer.length > 0) return pointer;
      return rectIntersection({ ...args, droppableContainers: sortableContainers });
    }

    // When dragging a transaction, only collide with droppable columns
    const columnContainers = args.droppableContainers.filter((c) =>
      columnIds.has(String(c.id))
    );
    const pointer = pointerWithin({ ...args, droppableContainers: columnContainers });
    if (pointer.length > 0) return pointer;
    return rectIntersection({ ...args, droppableContainers: columnContainers });
  };
}

// ─── Smart default column ordering ───────────────────────────────────────────

function getSmartColumnOrder(
  categories: Category[],
  currentUserId: string | null
): Category[] {
  // Check if user has customized sort_order (all defaults are 0-6 sequential)
  const hasCustomOrder = categories.some(
    (c, i) => c.sort_order !== i
  );

  if (hasCustomOrder) {
    return [...categories].sort((a, b) => a.sort_order - b.sort_order);
  }

  // Apply smart default ordering:
  // Uncategorized, Shared, Exclude, current user's categories, other user's categories
  const uncategorized = categories.filter((c) => c.name === "uncategorized");
  const shared = categories.filter((c) => c.name === "shared");
  const exclude = categories.filter((c) => c.name === "exclude");

  const hiddenCategoryNames = ["uncategorized", "shared", "exclude", "deleted"];

  const currentUserCats = categories.filter(
    (c) =>
      c.owner_user_id === currentUserId &&
      !hiddenCategoryNames.includes(c.name)
  );

  const otherUserCats = categories.filter(
    (c) =>
      c.owner_user_id !== null &&
      c.owner_user_id !== currentUserId &&
      !hiddenCategoryNames.includes(c.name)
  );

  const otherCats = categories.filter(
    (c) =>
      !hiddenCategoryNames.includes(c.name) &&
      c.owner_user_id === null &&
      !c.is_system
  );

  return [
    ...uncategorized,
    ...shared,
    ...exclude,
    ...currentUserCats.sort((a, b) => a.sort_order - b.sort_order),
    ...otherUserCats.sort((a, b) => a.sort_order - b.sort_order),
    ...otherCats.sort((a, b) => a.sort_order - b.sort_order),
  ];
}

// ─── Auto-categorize logic (client-side using merchant rules) ────────────────

function autoCategorizeTransaction(
  description: string,
  amount: number,
  rules: MerchantRule[]
): string | null {
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    try {
      const regex = new RegExp(rule.pattern, "i");
      if (!regex.test(description)) continue;

      if (rule.amount_hint !== null) {
        const diff = Math.abs(Math.abs(amount) - Math.abs(rule.amount_hint));
        if (diff > 5) continue;
      }

      if (rule.amount_max !== null && Math.abs(amount) > Math.abs(rule.amount_max)) {
        continue;
      }

      return rule.category_id;
    } catch {
      if (description.toLowerCase().includes(rule.pattern.toLowerCase())) {
        return rule.category_id;
      }
    }
  }

  return null;
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [userFilter, setUserFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [detailTransaction, setDetailTransaction] = useState<Transaction | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [autoSorting, setAutoSorting] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
  const draggingColumnIdRef = useRef<string | null>(null);
  const lastSelectedRef = useRef<string | null>(null);
  const fetchDecrypted = useDecryptedFetch();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    const month = format(currentMonth, "yyyy-MM");

    try {
      const [txData, catRes, usersRes, userRes, rulesRes] = await Promise.all([
        fetchDecrypted(`/api/transactions?month=${month}`),
        fetch("/api/categories"),
        fetch("/api/users"),
        fetch("/api/user"),
        fetch("/api/merchant-rules"),
      ]);

      if (catRes.ok) {
        const cats = await catRes.json();
        setCategories(cats);
        // Filter out transactions in the "Deleted" category
        const deletedCatId = cats.find((c: Category) => c.name === "deleted")?.id;
        const allTx = txData as Transaction[];
        setTransactions(deletedCatId ? allTx.filter((t) => t.category_id !== deletedCatId) : allTx);
      } else {
        setTransactions(txData as Transaction[]);
      }
      if (usersRes.ok) setUsers(await usersRes.json());
      if (userRes.ok) setCurrentUser(await userRes.json());
      if (rulesRes.ok) setMerchantRules(await rulesRes.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [currentMonth, fetchDecrypted]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Compute smart column order when categories or current user changes
  useEffect(() => {
    if (categories.length > 0) {
      const ordered = getSmartColumnOrder(categories, currentUser?.id || null);
      setColumnOrder(ordered.map((c) => c.id));
    }
  }, [categories, currentUser?.id]);

  const filteredTransactions =
    userFilter === "all"
      ? transactions
      : transactions.filter((t) => t.user_id === userFilter);

  const uncategorizedCat = categories.find((c) => c.name === "uncategorized");

  // Build columns from columnOrder
  const columns = columnOrder
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Category => c !== undefined)
    .map((c) => ({
      id: c.id,
      display_name: c.display_name,
      color: c.color,
    }));

  // Column droppable IDs are prefixed with "column:"
  const columnDroppableIds = new Set(columns.map((c) => `column:${c.id}`));
  const sortableColumnIds = new Set(columns.map((c) => `col:${c.id}`));
  const collisionDetection = smartCollision(columnDroppableIds, sortableColumnIds, draggingColumnIdRef);

  function getColumnTransactions(columnId: string) {
    if (uncategorizedCat && columnId === uncategorizedCat.id) {
      return filteredTransactions.filter(
        (t) => !t.category_id || t.category_id === columnId
      );
    }
    return filteredTransactions.filter((t) => t.category_id === columnId);
  }

  // Figure out which IDs are being dragged (active + selected if active is selected)
  const activeDragIds = activeId
    ? selectedIds.has(activeId)
      ? selectedIds
      : new Set([activeId])
    : new Set<string>();

  function handleToggleSelect(id: string, shiftKey: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (shiftKey && lastSelectedRef.current) {
        const allIds = filteredTransactions.map((t) => t.id);
        const lastIdx = allIds.indexOf(lastSelectedRef.current);
        const currentIdx = allIds.indexOf(id);
        if (lastIdx >= 0 && currentIdx >= 0) {
          const [start, end] = [
            Math.min(lastIdx, currentIdx),
            Math.max(lastIdx, currentIdx),
          ];
          for (let i = start; i <= end; i++) {
            next.add(allIds[i]);
          }
        }
      } else {
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      lastSelectedRef.current = id;
      return next;
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);

    // Check if this is a column drag
    if (id.startsWith("col:")) {
      const colId = id.replace("col:", "");
      setDraggingColumnId(colId);
      draggingColumnIdRef.current = colId;
      return;
    }

    setActiveId(id);
    setOverColumnId(null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event;
    if (!over) {
      setOverColumnId(null);
      return;
    }
    // Extract category id from "column:xxx"
    const overId = String(over.id);
    if (overId.startsWith("column:")) {
      setOverColumnId(overId.replace("column:", ""));
    } else {
      setOverColumnId(null);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const activeIdStr = String(active.id);

    // Handle column reorder
    if (activeIdStr.startsWith("col:")) {
      setDraggingColumnId(null);
      draggingColumnIdRef.current = null;

      if (!over) return;
      const overId = String(over.id);

      // Accept drops on both sortable col: items and droppable column: items
      let targetColId: string | null = null;
      if (overId.startsWith("col:")) {
        targetColId = overId.replace("col:", "");
      } else if (overId.startsWith("column:")) {
        targetColId = overId.replace("column:", "");
      }
      if (!targetColId) return;

      const draggedColId = activeIdStr.replace("col:", "");
      if (draggedColId === targetColId) return;

      const oldIndex = columnOrder.indexOf(draggedColId);
      const newIndex = columnOrder.indexOf(targetColId);

      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
      setColumnOrder(newOrder);

      // Persist the new order
      const orderPayload = newOrder.map((id, i) => ({ id, sort_order: i }));
      try {
        await fetch("/api/categories", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: orderPayload }),
        });
      } catch {
        // Revert on failure
        setColumnOrder(columnOrder);
      }

      return;
    }

    // Handle transaction drag
    setActiveId(null);
    setOverColumnId(null);

    if (!over) return;

    const overId = String(over.id);
    if (!overId.startsWith("column:")) return;

    const targetCategoryId = overId.replace("column:", "");

    const draggedId = activeIdStr;
    const idsToMove = selectedIds.has(draggedId)
      ? Array.from(selectedIds)
      : [draggedId];

    const hasCategoryChange = idsToMove.some((id) => {
      const transaction = transactions.find((t) => t.id === id);
      const sourceCategoryId = transaction?.category_id || uncategorizedCat?.id;
      return sourceCategoryId !== targetCategoryId;
    });

    if (!hasCategoryChange) return;

    // Optimistic update
    const resolvedTargetId =
      uncategorizedCat && targetCategoryId === uncategorizedCat.id
        ? null
        : targetCategoryId;

    setTransactions((prev) =>
      prev.map((t) =>
        idsToMove.includes(t.id)
          ? { ...t, category_id: resolvedTargetId }
          : t
      )
    );
    setSelectedIds(new Set());

    // API call in background
    try {
      const res = await fetch("/api/transactions/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionIds: idsToMove,
          category_id: resolvedTargetId,
        }),
      });

      if (!res.ok) {
        toast.error("Failed to update transactions");
        fetchData(); // Revert by re-fetching
        return;
      }

      toast.success(`Moved ${idsToMove.length} transaction(s)`);

      // Auto-create/update merchant rules
      if (resolvedTargetId) {
        const movedTxs = transactions.filter((t) => idsToMove.includes(t.id));
        const uniqueDescriptions = [
          ...new Set(movedTxs.map((t) => t.description.toLowerCase().trim())),
        ];

        const ruleResults = await Promise.all(
          uniqueDescriptions.map(async (desc) => {
            // Check if rule already exists for this pattern
            const existingRule = merchantRules.find(
              (r) => r.pattern.toLowerCase() === desc
            );

            try {
              if (existingRule) {
                // Update existing rule to new category
                const ruleRes = await fetch("/api/merchant-rules", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: existingRule.id,
                    category_id: resolvedTargetId,
                  }),
                });
                return ruleRes.ok ? "updated" : false;
              } else {
                // Create new rule
                const ruleRes = await fetch("/api/merchant-rules", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    pattern: desc,
                    category_id: resolvedTargetId,
                    is_learned: true,
                  }),
                });
                return ruleRes.ok ? "created" : false;
              }
            } catch {
              return false;
            }
          })
        );

        const created = ruleResults.filter((r) => r === "created").length;
        const updated = ruleResults.filter((r) => r === "updated").length;

        if (created > 0 || updated > 0) {
          const parts = [];
          if (created > 0) parts.push(`Created ${created} rule${created > 1 ? "s" : ""}`);
          if (updated > 0) parts.push(`Updated ${updated} rule${updated > 1 ? "s" : ""}`);
          toast.success(parts.join(", "));

          // Refresh rules
          const rulesRes = await fetch("/api/merchant-rules");
          if (rulesRes.ok) setMerchantRules(await rulesRes.json());
        }
      }
    } catch {
      toast.error("Failed to update transactions");
      fetchData(); // Revert
    }
  }

  async function handleAutoSort() {
    if (!uncategorizedCat || merchantRules.length === 0) {
      toast.error("No merchant rules available for auto-sorting");
      return;
    }

    setAutoSorting(true);

    const uncategorizedTxs = filteredTransactions.filter(
      (t) => !t.category_id || t.category_id === uncategorizedCat.id
    );

    // Match each uncategorized transaction against rules
    const matches: { transactionId: string; categoryId: string }[] = [];

    for (const tx of uncategorizedTxs) {
      const categoryId = autoCategorizeTransaction(
        tx.description,
        tx.amount,
        merchantRules
      );
      if (categoryId) {
        matches.push({ transactionId: tx.id, categoryId });
      }
    }

    if (matches.length === 0) {
      toast.info("No matching rules found for uncategorized transactions");
      setAutoSorting(false);
      return;
    }

    // Group by category for bulk updates
    const grouped = new Map<string, string[]>();
    for (const match of matches) {
      const ids = grouped.get(match.categoryId) || [];
      ids.push(match.transactionId);
      grouped.set(match.categoryId, ids);
    }

    // Optimistic update
    setTransactions((prev) =>
      prev.map((t) => {
        const match = matches.find((m) => m.transactionId === t.id);
        return match ? { ...t, category_id: match.categoryId } : t;
      })
    );

    // Send bulk updates per category
    let successCount = 0;
    try {
      for (const [categoryId, transactionIds] of grouped) {
        const res = await fetch("/api/transactions/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionIds, category_id: categoryId }),
        });
        if (res.ok) {
          successCount += transactionIds.length;
        }
      }

      if (successCount > 0) {
        toast.success(`Auto-sorted ${successCount} transaction${successCount > 1 ? "s" : ""}`);
      }
    } catch {
      toast.error("Failed to auto-sort some transactions");
      fetchData();
    } finally {
      setAutoSorting(false);
    }
  }

  async function handleEnrich(tx: Transaction) {
    setEnriching(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionIds: [tx.id] }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to enrich");
        return;
      }

      const data = await res.json();
      if (data.enriched > 0) {
        const txRes = await fetch(`/api/transactions/${tx.id}`);
        if (txRes.ok) {
          const updated = await txRes.json();
          setDetailTransaction(updated);
          setTransactions((prev) =>
            prev.map((t) => (t.id === updated.id ? updated : t))
          );
        }
        toast.success("Transaction enriched");
      } else {
        toast.error("Enrichment failed");
      }
    } catch {
      toast.error("Failed to enrich transaction");
    } finally {
      setEnriching(false);
    }
  }

  function handleUpdateTransaction(updated: Transaction) {
    setDetailTransaction(updated);
    setTransactions((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t))
    );
  }

  async function handleDeleteTransaction(transaction: Transaction) {
    const deletedCategory = categories.find((c) => c.name === "deleted");
    if (!deletedCategory) {
      toast.error("Deleted category not found");
      return;
    }

    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: deletedCategory.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[handleDeleteTransaction]", data);
        toast.error(data.error || "Failed to delete transaction");
        return;
      }

      setTransactions((prev) => prev.filter((t) => t.id !== transaction.id));
      setDetailTransaction(null);
      toast.success("Transaction moved to Deleted", {
        action: {
          label: "Restore in Settings",
          onClick: () => window.location.assign("/dashboard/settings"),
        },
      });
    } catch {
      toast.error("Failed to delete transaction");
    }
  }

  async function handleCardChangeUser(transactionId: string, userId: string) {
    const ids = selectedIds.has(transactionId) ? Array.from(selectedIds) : [transactionId];

    // Optimistic update
    setTransactions((prev) =>
      prev.map((t) => (ids.includes(t.id) ? { ...t, user_id: userId } : t))
    );

    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/transactions/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId }),
          })
        )
      );
      const userName = users.find((u) => u.id === userId)?.name || "user";
      toast.success(`Updated payer to ${userName} for ${ids.length} transaction(s)`);
    } catch {
      toast.error("Failed to update payer");
      fetchData();
    }
  }

  async function handleCardChangeCategory(transactionId: string, categoryId: string | null) {
    const ids = selectedIds.has(transactionId) ? Array.from(selectedIds) : [transactionId];

    // Optimistic update
    setTransactions((prev) =>
      prev.map((t) => (ids.includes(t.id) ? { ...t, category_id: categoryId } : t))
    );
    setSelectedIds(new Set());

    try {
      const res = await fetch("/api/transactions/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionIds: ids, category_id: categoryId }),
      });
      if (!res.ok) {
        toast.error("Failed to update category");
        fetchData();
        return;
      }
      toast.success(`Updated category for ${ids.length} transaction(s)`);
    } catch {
      toast.error("Failed to update category");
      fetchData();
    }
  }

  const activeTransaction = activeId
    ? transactions.find((t) => t.id === activeId)
    : null;

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Transactions</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[140px] text-center font-medium">
            {format(currentMonth, "MMMM yyyy")}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* User filter tabs */}
      <div className="flex gap-2">
        <Button
          variant={userFilter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setUserFilter("all")}
        >
          All
        </Button>
        {users.map((u) => (
          <Button
            key={u.id}
            variant={userFilter === u.id ? "default" : "outline"}
            size="sm"
            onClick={() => setUserFilter(u.id)}
          >
            {u.name}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setDraggingColumnId(null);
            draggingColumnIdRef.current = null;
            setActiveId(null);
            setOverColumnId(null);
          }}
        >
          <SortableContext
            items={columnOrder.map((id) => `col:${id}`)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex gap-4 overflow-x-auto pb-4">
              {columns.map((col) => (
                <CategoryColumn
                  key={col.id}
                  category={col}
                  categories={categories}
                  transactions={getColumnTransactions(col.id)}
                  users={users}
                  selectedIds={selectedIds}
                  activeId={activeId}
                  activeDragIds={activeDragIds}
                  isOverThis={overColumnId === col.id}
                  isUncategorized={uncategorizedCat?.id === col.id}
                  autoSorting={autoSorting}
                  onToggleSelect={handleToggleSelect}
                  onClickDetail={setDetailTransaction}
                  onAutoSort={handleAutoSort}
                  onChangeUser={handleCardChangeUser}
                  onChangeCategory={handleCardChangeCategory}
                />
              ))}
            </div>
          </SortableContext>

          <DragOverlay
            dropAnimation={{
              duration: 250,
              easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
            }}
          >
            {activeTransaction && (
              <TransactionCardOverlay
                transaction={activeTransaction}
                users={users}
                selectedCount={activeId && selectedIds.has(activeId) ? selectedIds.size : 1}
              />
            )}
            {/* Column drag is handled by useSortable inline transforms */}
          </DragOverlay>
        </DndContext>
      )}

      {/* Transaction detail dialog */}
      <TransactionDetailDialog
        transaction={detailTransaction}
        categories={categories}
        users={users}
        enriching={enriching}
        onClose={() => setDetailTransaction(null)}
        onEnrich={handleEnrich}
        onUpdate={handleUpdateTransaction}
        onDelete={handleDeleteTransaction}
      />
    </div>
  );
}
