"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  parseISO,
  isWithinInterval,
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
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Loader2,
  GripVertical,
  Wand2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { toast } from "sonner";
import type { Transaction, Category, User, MerchantRule, Settlement } from "@/lib/types";
import { encryptMerchantRule, encryptTransaction } from "@/lib/crypto/entity-crypto";
import { useData } from "@/lib/crypto/data-provider";
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog";

function formatCurrency(amount: number) {
  return Math.abs(amount).toLocaleString("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatSignedCurrency(amount: number) {
  if (Math.abs(amount) < 0.01) {
    return formatCurrency(0);
  }

  return `${amount > 0 ? "+" : "-"}${formatCurrency(amount)}`;
}

function getTransactionAmountClassName(amount: number) {
  return amount >= 0
    ? "text-green-600 dark:text-green-400"
    : "text-muted-foreground";
}

function getSettledTransactionIds(settlements: Settlement[]) {
  const ids = new Set<string>();

  for (const settlement of settlements) {
    if (settlement.settlement_batches?.length) {
      for (const batch of settlement.settlement_batches) {
        for (const transaction of batch.transactions || []) {
          ids.add(transaction.id);
        }
      }
      continue;
    }

    for (const transaction of settlement.settled_transactions || []) {
      ids.add(transaction.id);
    }
  }

  return ids;
}

function splitMutableTransactionIds(
  ids: string[],
  settledTransactionIds: Set<string>
) {
  const mutableIds: string[] = [];
  let frozenCount = 0;

  for (const id of ids) {
    if (settledTransactionIds.has(id)) {
      frozenCount += 1;
    } else {
      mutableIds.push(id);
    }
  }

  return { mutableIds, frozenCount };
}

function toastSettledTransactionsLocked() {
  toast.error("Settled transactions are locked. You can still add notes.");
}

function toastSkippedFrozenTransactions(frozenCount: number) {
  if (frozenCount > 0) {
    toast.warning(
      `Skipped ${frozenCount} settled transaction${frozenCount === 1 ? "" : "s"} because payer and category are locked`
    );
  }
}

// ─── Draggable Transaction Card ──────────────────────────────────────────────

function TransactionCard({
  transaction,
  categories,
  users,
  isFrozen,
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
  isFrozen: boolean;
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
    disabled: isFrozen,
  });

  const user = users.find((u) => u.id === transaction.user_id);
  const userIndex = users.findIndex((u) => u.id === transaction.user_id);
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
          : isFrozen
            ? "cursor-default hover:shadow-sm shadow-sm"
            : "cursor-grab active:cursor-grabbing hover:shadow-md shadow-sm"
      } ${isSelected && !isHidden ? "bg-primary/5 border-primary shadow-[inset_0_0_0_1px_hsl(var(--primary))]" : ""}`}
      {...attributes}
      {...listeners}
    >
      {/* Payer avatar + Checkbox stacked */}
      <div onPointerDown={(e) => e.stopPropagation()} className="flex flex-col items-center gap-1.5 pt-1">
        {isFrozen ? (
          <button
            type="button"
            title="Payer is locked because this transaction is part of a settled batch"
            className={`rounded-full ring-2 ring-offset-1 opacity-70 ${userIndex === 0 ? "ring-primary" : "ring-warm"}`}
            onClick={() => onClickDetail(transaction)}
          >
            <Avatar className="h-4 w-4">
              {user?.avatar_url && <AvatarImage src={user.avatar_url} />}
              <AvatarFallback className="text-[7px] font-semibold">
                {user?.name?.[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          </button>
        ) : (
          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  title={`Payer: ${user?.name || "?"}`}
                  className={`rounded-full ring-2 ring-offset-1 transition-colors hover:ring-offset-2 ${userIndex === 0 ? "ring-primary" : "ring-warm"}`}
                >
                  <Avatar className="h-4 w-4">
                    {user?.avatar_url && <AvatarImage src={user.avatar_url} />}
                    <AvatarFallback className="text-[7px] font-semibold">
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
              {users.map((u) => (
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
        )}
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
          <span
            className={`shrink-0 text-xs font-mono ${getTransactionAmountClassName(transaction.amount)}`}
          >
            {formatSignedCurrency(transaction.amount)}
          </span>
        </div>

        {/* Row 2: Date + enrichment | Category */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              {format(new Date(transaction.date), "MMM d")}
            </span>
            {isFrozen && (
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                Settled
              </Badge>
            )}
            {transaction.bank_name && (
              <span className="text-[10px] text-muted-foreground/70">
                · {transaction.bank_name}
              </span>
            )}
            {transaction.enriched_at && (
              <Sparkles className="h-3 w-3 text-amber-500" />
            )}
          </div>

          {/* Category badge */}
          <div onPointerDown={(e) => e.stopPropagation()}>
            {isFrozen ? (
              <button
                type="button"
                title="Category is locked because this transaction is part of a settled batch"
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0 h-[18px] text-[10px] font-medium text-muted-foreground opacity-70"
                onClick={() => onClickDetail(transaction)}
              >
                {displayCategory?.color && (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: displayCategory.color }}
                  />
                )}
                {displayCategory?.display_name?.replace(/^[^\w\s]*\s*/, "").split(" ")[0] || "Uncategorized"}
              </button>
            ) : (
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
            )}
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
            <span
              className={`text-xs font-mono ${getTransactionAmountClassName(transaction.amount)}`}
            >
              {formatSignedCurrency(transaction.amount)}
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
  settledTransactionIds,
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
  settledTransactionIds: Set<string>;
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
              isFrozen={settledTransactionIds.has(t.id)}
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
  // Always apply smart default ordering per viewer:
  // Uncategorized, other user's cats, Shared, current user's cats, Exclude
  // This way you review the other person's spending first, then shared, then your own.
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
    ...otherUserCats.sort((a, b) => a.sort_order - b.sort_order),
    ...shared,
    ...currentUserCats.sort((a, b) => a.sort_order - b.sort_order),
    ...exclude,
    ...otherCats.sort((a, b) => a.sort_order - b.sort_order),
  ];
}

// ─── Auto-categorize logic (client-side using merchant rules) ────────────────

function autoCategorizeTransaction(
  description: string,
  amount: number,
  rules: MerchantRule[]
): string | null {
  // Only use pattern rules for manual auto-sort (not auto_import rules)
  const patternRules = rules.filter((r) => r.rule_type === "pattern");
  const sortedRules = [...patternRules].sort((a, b) => b.priority - a.priority);

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
  const data = useData();
  const [currentMonth, setCurrentMonth] = useState<Date | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // Local aliases from central cache
  const categories = data.categories;
  const users = data.users;
  const currentUser = data.currentUser;
  const merchantRules = data.merchantRules;
  const settledTransactionIds = getSettledTransactionIds(data.settlements);
  const loading = data.loading && data.lastFetched === 0;
  const [userFilter, setUserFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<"date" | "description" | "amount">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [detailTransaction, setDetailTransaction] = useState<Transaction | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [autoSorting, setAutoSorting] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const draggingColumnIdRef = useRef<string | null>(null);
  const lastSelectedRef = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Filter transactions by month from the central cache
  useEffect(() => {
    const allTx = data.transactions;
    if (allTx.length === 0 && data.loading) return;

    // Auto-detect month from most recent transaction on first load
    let activeMonth = currentMonth;
    if (!activeMonth && allTx.length > 0) {
      let latest: Date | null = null;
      for (const t of allTx) {
        if (!t.date) continue;
        try {
          const d = parseISO(t.date);
          if (!latest || d > latest) latest = d;
        } catch { /* skip */ }
      }
      activeMonth = startOfMonth(latest ?? new Date());
      setCurrentMonth(activeMonth);
      return; // Will re-run with activeMonth set
    }
    if (!activeMonth) {
      activeMonth = startOfMonth(new Date());
      setCurrentMonth(activeMonth);
      return;
    }

    const monthStart = startOfMonth(activeMonth);
    const monthEnd = endOfMonth(activeMonth);
    const deletedCatId = categories.find((c) => c.name === "deleted")?.id;

    const filtered = allTx.filter((t) => {
      if (!t.date) return false;
      if (deletedCatId && t.category_id === deletedCatId) return false;
      try {
        return isWithinInterval(parseISO(t.date), { start: monthStart, end: monthEnd });
      } catch {
        return false;
      }
    });

    setTransactions(filtered);
  }, [data.transactions, data.loading, currentMonth, categories]);

  // Re-fetch after drag-and-drop changes
  const fetchData = useCallback(async () => {
    await data.refreshTransactions();
  }, [data]);

  // Compute smart column order when categories or current user changes
  // Per-user column order is stored in localStorage
  useEffect(() => {
    if (categories.length > 0 && currentUser?.id) {
      const storageKey = `tx-col-order:${currentUser.id}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const savedOrder = JSON.parse(saved) as string[];
          // Validate saved IDs still exist, append any new categories
          const catIds = new Set(categories.filter((c) => c.name !== "deleted").map((c) => c.id));
          const valid = savedOrder.filter((id) => catIds.has(id));
          const missing = [...catIds].filter((id) => !valid.includes(id));
          if (valid.length > 0) {
            setColumnOrder([...valid, ...missing]);
            return;
          }
        } catch { /* fall through to smart default */ }
      }
      const ordered = getSmartColumnOrder(categories, currentUser.id);
      setColumnOrder(ordered.map((c) => c.id));
    }
  }, [categories, currentUser?.id]);

  const filteredTransactions = useMemo(() => {
    const base = userFilter === "all"
      ? transactions
      : transactions.filter((t) => t.user_id === userFilter);
    // Guard against duplicate IDs (e.g. from state merges after import)
    const seen = new Set<string>();
    return base.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [transactions, userFilter]);

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
    let txns: Transaction[];
    if (uncategorizedCat && columnId === uncategorizedCat.id) {
      txns = filteredTransactions.filter(
        (t) => !t.category_id || t.category_id === columnId
      );
    } else {
      txns = filteredTransactions.filter((t) => t.category_id === columnId);
    }

    const dir = sortDirection === "asc" ? 1 : -1;
    return [...txns].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = (a.date || "").localeCompare(b.date || "");
          break;
        case "description": {
          const nameA = (a.enriched_name || a.description || "").toLowerCase();
          const nameB = (b.enriched_name || b.description || "").toLowerCase();
          cmp = nameA.localeCompare(nameB);
          break;
        }
        case "amount":
          cmp = Math.abs(a.amount) - Math.abs(b.amount);
          break;
      }
      return cmp * dir;
    });
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

      // Persist per-user column order in localStorage
      if (currentUser?.id) {
        localStorage.setItem(`tx-col-order:${currentUser.id}`, JSON.stringify(newOrder));
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
    const { mutableIds, frozenCount } = splitMutableTransactionIds(
      idsToMove,
      settledTransactionIds
    );

    if (mutableIds.length === 0) {
      toastSettledTransactionsLocked();
      return;
    }

    toastSkippedFrozenTransactions(frozenCount);

    const hasCategoryChange = mutableIds.some((id) => {
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
        mutableIds.includes(t.id)
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
          transactionIds: mutableIds,
          category_id: resolvedTargetId,
        }),
      });

      if (!res.ok) {
        toast.error("Failed to update transactions");
        fetchData(); // Revert by re-fetching
        return;
      }

      // Sync optimistic update to DataProvider cache so navigation doesn't revert
      data.updateTransactions((prev) =>
        prev.map((t) =>
          mutableIds.includes(t.id) ? { ...t, category_id: resolvedTargetId } : t
        )
      );
      toast.success(`Moved ${mutableIds.length} transaction(s)`);

      // Auto-create/update merchant rules (skip for Deleted/Uncategorized, but include Exclude)
      const targetCat = categories.find((c) => c.id === resolvedTargetId);
      const isExclude = targetCat?.name === "exclude";
      const isDeleted = targetCat?.name === "deleted";
      const skipAutoLearn = !resolvedTargetId || isDeleted;

      if (!skipAutoLearn) {
        // Use the pre-optimistic-update transactions to get descriptions
        // (closured `transactions` still has the old state before setTransactions)
        const movedTxs = transactions.filter((t) => mutableIds.includes(t.id));
        const uniqueDescriptions = [
          ...new Set(
            movedTxs
              .map((t) => t.description?.toLowerCase().trim())
              .filter((d): d is string => !!d && d !== "[encrypted]" && d !== "[decryption failed]")
          ),
        ];

        // Batch: separate new vs existing rules
        const toCreate: string[] = [];
        const toUpdate: { id: string; desc: string }[] = [];

        for (const desc of uniqueDescriptions) {
          const existing = merchantRules.find(
            (r) => r.pattern.toLowerCase() === desc
          );
          if (existing) {
            if (existing.category_id !== resolvedTargetId) {
              toUpdate.push({ id: existing.id, desc });
            }
          } else {
            toCreate.push(desc);
          }
        }

        // Fire updates/creates in parallel but don't block the UI
        const rulePromises: Promise<unknown>[] = [];

        for (const item of toUpdate) {
          rulePromises.push(
            fetch("/api/merchant-rules", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: item.id, category_id: resolvedTargetId }),
            })
          );
        }

        // Batch-encrypt new rules
        for (const desc of toCreate) {
          rulePromises.push(
            (async () => {
              const encrypted_data = await encryptMerchantRule({
                pattern: desc,
                rule_type: "pattern",
                match_transaction_type: null,
                merchant_name: null,
                merchant_type: null,
                amount_hint: null,
                amount_max: null,
                notes: null,
              });
              return fetch("/api/merchant-rules", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  encrypted_data,
                  category_id: resolvedTargetId,
                  is_learned: true,
                }),
              });
            })()
          );
        }

        if (rulePromises.length > 0) {
          await Promise.all(rulePromises);
          // Refresh rules via cache
          await data.refreshMerchantRules();
          const parts: string[] = [];
          if (toCreate.length > 0) parts.push(`${toCreate.length} rule(s) created`);
          if (toUpdate.length > 0) parts.push(`${toUpdate.length} rule(s) updated`);
          toast.success(parts.join(", "), {
            action: {
              label: "Edit rules",
              onClick: () => window.location.assign("/dashboard/settings?tab=rules"),
            },
          });
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
      (t) =>
        (!t.category_id || t.category_id === uncategorizedCat.id) &&
        !settledTransactionIds.has(t.id)
    );

    if (uncategorizedTxs.length === 0) {
      toast.info("No editable uncategorized transactions to auto-sort");
      setAutoSorting(false);
      return;
    }

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
        const categoryMap = new Map(categories.map((c) => [c.id, c.name || c.display_name || "Unknown"]));
        const lines = matches.map((m) => {
          const tx = uncategorizedTxs.find((t) => t.id === m.transactionId);
          const desc = tx?.description || "Unknown";
          const cat = categoryMap.get(m.categoryId) || "Unknown";
          return { desc, cat };
        });
        toast.success(`Auto-sorted ${successCount} transaction${successCount > 1 ? "s" : ""}`, {
          description: (
            <ul className="mt-1 space-y-0.5 text-xs">
              {lines.map((l, i) => (
                <li key={i}>{l.desc} → <span className="font-medium">{l.cat}</span></li>
              ))}
            </ul>
          ),
          duration: 8000,
        });
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
        body: JSON.stringify({
          transactionIds: [tx.id],
          descriptions: [{ id: tx.id, name: tx.description }],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to enrich");
        return;
      }

      const enrichData = await res.json();
      if (enrichData.enriched > 0 && enrichData.results?.[0]) {
        const result = enrichData.results[0];
        const updated: Transaction = {
          ...tx,
          enriched_name: result.merchant_name ?? tx.enriched_name,
          enriched_info: result.merchant_type ?? tx.enriched_info,
          enriched_description: result.merchant_description ?? tx.enriched_description,
          enriched_address: result.merchant_address ?? tx.enriched_address,
        };

        // Encrypt and save back to server
        const encrypted_data = await encryptTransaction(
          updated as unknown as Record<string, unknown>
        );
        await fetch(`/api/transactions/${tx.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ encrypted_data }),
        });

        setDetailTransaction(updated);
        setTransactions((prev) =>
          prev.map((t) => (t.id === updated.id ? updated : t))
        );
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
    // Sync to DataProvider cache so navigation doesn't revert
    data.updateTransactions((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t))
    );
  }

  async function handleCardChangeUser(transactionId: string, userId: string) {
    const ids = selectedIds.has(transactionId) ? Array.from(selectedIds) : [transactionId];
    const { mutableIds, frozenCount } = splitMutableTransactionIds(
      ids,
      settledTransactionIds
    );

    if (mutableIds.length === 0) {
      toastSettledTransactionsLocked();
      return;
    }

    toastSkippedFrozenTransactions(frozenCount);

    // Optimistic update
    setTransactions((prev) =>
      prev.map((t) => (mutableIds.includes(t.id) ? { ...t, user_id: userId } : t))
    );

    try {
      await Promise.all(
        mutableIds.map((id) =>
          fetch(`/api/transactions/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId }),
          })
        )
      );
      // Sync optimistic update to DataProvider cache so navigation doesn't revert
      data.updateTransactions((prev) =>
        prev.map((t) =>
          mutableIds.includes(t.id) ? { ...t, user_id: userId } : t
        )
      );
      const userName = users.find((u) => u.id === userId)?.name || "user";
      toast.success(`Updated payer to ${userName} for ${mutableIds.length} transaction(s)`);
    } catch {
      toast.error("Failed to update payer");
      fetchData();
    }
  }

  async function handleCardChangeCategory(transactionId: string, categoryId: string | null) {
    const ids = selectedIds.has(transactionId) ? Array.from(selectedIds) : [transactionId];
    const { mutableIds, frozenCount } = splitMutableTransactionIds(
      ids,
      settledTransactionIds
    );

    if (mutableIds.length === 0) {
      toastSettledTransactionsLocked();
      return;
    }

    toastSkippedFrozenTransactions(frozenCount);

    // Optimistic update
    setTransactions((prev) =>
      prev.map((t) => (mutableIds.includes(t.id) ? { ...t, category_id: categoryId } : t))
    );
    setSelectedIds(new Set());

    try {
      const res = await fetch("/api/transactions/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionIds: mutableIds, category_id: categoryId }),
      });
      if (!res.ok) {
        toast.error("Failed to update category");
        fetchData();
        return;
      }
      // Sync optimistic update to DataProvider cache so navigation doesn't revert
      data.updateTransactions((prev) =>
        prev.map((t) =>
          mutableIds.includes(t.id) ? { ...t, category_id: categoryId } : t
        )
      );
      toast.success(`Updated category for ${mutableIds.length} transaction(s)`);

      // Auto-create/update merchant rules (same logic as drag-and-drop)
      const targetCat = categories.find((c) => c.id === categoryId);
      const isDeleted = targetCat?.name === "deleted";
      const skipAutoLearn = !categoryId || isDeleted;

      if (!skipAutoLearn) {
        const movedTxs = transactions.filter((t) => mutableIds.includes(t.id));
        const uniqueDescriptions = [
          ...new Set(
            movedTxs
              .map((t) => t.description?.toLowerCase().trim())
              .filter((d): d is string => !!d && d !== "[encrypted]" && d !== "[decryption failed]")
          ),
        ];

        const toCreate: string[] = [];
        const toUpdate: { id: string; desc: string }[] = [];

        for (const desc of uniqueDescriptions) {
          const existing = merchantRules.find(
            (r) => r.pattern.toLowerCase() === desc
          );
          if (existing) {
            if (existing.category_id !== categoryId) {
              toUpdate.push({ id: existing.id, desc });
            }
          } else {
            toCreate.push(desc);
          }
        }

        const rulePromises: Promise<unknown>[] = [];

        for (const item of toUpdate) {
          rulePromises.push(
            fetch("/api/merchant-rules", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: item.id, category_id: categoryId }),
            })
          );
        }

        for (const desc of toCreate) {
          rulePromises.push(
            (async () => {
              const encrypted_data = await encryptMerchantRule({
                pattern: desc,
                rule_type: "pattern",
                match_transaction_type: null,
                merchant_name: null,
                merchant_type: null,
                amount_hint: null,
                amount_max: null,
                notes: null,
              });
              return fetch("/api/merchant-rules", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  encrypted_data,
                  category_id: categoryId,
                  is_learned: true,
                }),
              });
            })()
          );
        }

        if (rulePromises.length > 0) {
          await Promise.all(rulePromises);
          await data.refreshMerchantRules();
          const parts: string[] = [];
          if (toCreate.length > 0) parts.push(`${toCreate.length} rule(s) created`);
          if (toUpdate.length > 0) parts.push(`${toUpdate.length} rule(s) updated`);
          toast.success(parts.join(", "), {
            action: {
              label: "Edit rules",
              onClick: () => window.location.assign("/dashboard/settings?tab=rules"),
            },
          });
        }
      }
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
            onClick={() => setCurrentMonth(subMonths(currentMonth || new Date(), 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[140px] text-center font-medium">
            {currentMonth ? format(currentMonth, "MMMM yyyy") : "Loading\u2026"}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentMonth(addMonths(currentMonth || new Date(), 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* User filter tabs + Sort controls */}
      <div className="flex items-center justify-between gap-4">
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

        <div className="flex items-center gap-1">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground mr-1" />
          {(["date", "description", "amount"] as const).map((field) => (
            <Button
              key={field}
              variant={sortField === field ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs capitalize"
              onClick={() => {
                if (sortField === field) {
                  setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
                } else {
                  setSortField(field);
                  setSortDirection(field === "description" ? "asc" : "desc");
                }
              }}
            >
              {field}
              {sortField === field && (
                sortDirection === "asc"
                  ? <ArrowUp className="h-3 w-3 ml-0.5" />
                  : <ArrowDown className="h-3 w-3 ml-0.5" />
              )}
            </Button>
          ))}
        </div>
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
                  settledTransactionIds={settledTransactionIds}
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
        isFrozen={!!detailTransaction && settledTransactionIds.has(detailTransaction.id)}
        enriching={enriching}
        onClose={() => setDetailTransaction(null)}
        onEnrich={handleEnrich}
        onUpdate={handleUpdateTransaction}
      />
    </div>
  );
}
