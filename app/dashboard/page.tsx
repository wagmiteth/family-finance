"use client";

import { useEffect, useState, useCallback } from "react";
import {
  format,
  startOfMonth,
  addMonths,
  subMonths,
} from "date-fns";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { Transaction, Category, User, Household } from "@/lib/types";
import { useDecryptedFetch } from "@/lib/crypto/use-decrypted-fetch";
import { InviteBanner } from "@/components/invite-banner";

function formatCurrency(amount: number) {
  return amount.toLocaleString("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatCompact(amount: number) {
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}k`;
  }
  return Math.round(amount).toString();
}

// Chart colors that match our earthy palette
const CHART_COLORS = [
  "oklch(0.50 0.08 155)",  // olive
  "oklch(0.62 0.14 38)",   // terracotta
  "oklch(0.55 0.10 170)",  // teal
  "oklch(0.58 0.12 70)",   // amber
  "oklch(0.50 0.08 290)",  // plum
  "oklch(0.60 0.06 130)",  // moss
  "oklch(0.55 0.10 20)",   // rust
  "oklch(0.58 0.08 200)",  // steel
];

export default function DashboardPage() {
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchDecrypted = useDecryptedFetch();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const month = format(currentMonth, "yyyy-MM");

    try {
      const [txData, catRes, usersRes, householdRes] = await Promise.all([
        fetchDecrypted(`/api/transactions?month=${month}`),
        fetch("/api/categories"),
        fetch("/api/users"),
        fetch("/api/household"),
      ]);

      setTransactions(txData as Transaction[]);
      if (catRes.ok) setCategories(await catRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
      if (householdRes.ok) {
        const data = await householdRes.json();
        setHousehold(data.household);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [currentMonth, fetchDecrypted]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const sharedCategoryIds = new Set(
    categories.filter((c) => c.split_type === "equal").map((c) => c.id)
  );
  const sharedTransactions = transactions.filter(
    (t) => t.category_id && sharedCategoryIds.has(t.category_id)
  );
  const sharedTotal = sharedTransactions.reduce(
    (sum, t) => sum + Math.abs(t.amount),
    0
  );

  const user1 = users[0];
  const user2 = users[1];

  const user1Paid = sharedTransactions
    .filter((t) => t.user_id === user1?.id)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const user2Paid = sharedTransactions
    .filter((t) => t.user_id === user2?.id)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // Per-category split ratios
  let user1Owes = 0;
  for (const t of sharedTransactions) {
    const cat = categoryById.get(t.category_id!);
    const ratio = (cat?.split_ratio ?? 50) / 100;
    user1Owes += Math.abs(t.amount) * ratio;
  }
  const user1Net = user1Paid - user1Owes;
  const settlementFrom = user1Net < 0 ? user1 : user2;
  const settlementTo = user1Net < 0 ? user2 : user1;
  const settlementAmount = Math.abs(user1Net);

  // Category breakdown
  const categoryTotals = new Map<string, number>();
  for (const t of transactions) {
    const catId = t.category_id || "uncategorized";
    categoryTotals.set(catId, (categoryTotals.get(catId) || 0) + Math.abs(t.amount));
  }
  const chartData = Array.from(categoryTotals.entries())
    .map(([catId, total]) => ({
      name: categoryById.get(catId)?.display_name || "Uncategorized",
      total,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const totalSpend = transactions.reduce((s, t) => s + Math.abs(t.amount), 0);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header with month navigation */}
      <div className="animate-fade-up">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-1">
              Monthly Overview
            </p>
            <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight text-foreground">
              {format(currentMonth, "MMMM yyyy")}
            </h1>
          </div>
          <div className="flex items-center gap-1 mb-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="mt-3 h-px bg-gradient-to-r from-border via-border to-transparent" />
      </div>

      {/* Invite banner — shown until partner joins */}
      {!loading && users.length < 2 && household?.invite_code && (
        <div className="animate-fade-up">
          <InviteBanner inviteCode={household.invite_code} inviterName={users[0]?.name} compact />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading data...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Main summary — editorial hero */}
          <div className="animate-fade-up stagger-1">
            <div className="grid gap-5 md:grid-cols-3">
              {/* Shared total — large hero card */}
              <Link href="/dashboard/transactions" className="md:col-span-2">
              <Card className="md:col-span-1 overflow-hidden relative hover:ring-1 hover:ring-primary/20 transition-shadow cursor-pointer">
                <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-primary/5 -translate-y-1/2 translate-x-1/4" />
                <CardContent className="pt-6 pb-7 px-6 relative">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-4">
                    Total Shared Expenses
                  </p>
                  <div className="flex items-baseline gap-3">
                    <span className="font-heading text-4xl md:text-5xl font-bold tracking-tight">
                      {formatCurrency(sharedTotal)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    {sharedTransactions.length} shared transaction{sharedTransactions.length !== 1 ? "s" : ""} this month
                  </p>

                  {/* User breakdown bar */}
                  {sharedTotal > 0 && user1 && user2 && (
                    <div className="mt-6">
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="font-medium">{user1.name}</span>
                        <span className="font-medium">{user2.name}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
                          style={{ width: `${(user1Paid / sharedTotal) * 100}%` }}
                        />
                        <div
                          className="h-full rounded-full bg-warm transition-all duration-700 ease-out"
                          style={{ width: `${(user2Paid / sharedTotal) * 100}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5">
                        <span className="font-mono">{formatCurrency(user1Paid)}</span>
                        <span className="font-mono">{formatCurrency(user2Paid)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              </Link>

              {/* Settlement card */}
              <Link href="/dashboard/settlements">
              <Card className="relative overflow-hidden hover:ring-1 hover:ring-primary/20 transition-shadow cursor-pointer h-full">
                <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full bg-warm/5 translate-y-1/2 -translate-x-1/4" />
                <CardContent className="pt-6 pb-7 px-6 relative flex flex-col justify-between h-full">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-4">
                      Settlement
                    </p>
                    <span className="font-heading text-3xl font-bold tracking-tight">
                      {formatCurrency(settlementAmount)}
                    </span>
                  </div>
                  {settlementAmount > 0 && settlementFrom && settlementTo ? (
                    <div className="mt-5 flex items-center gap-2 text-sm">
                      <span className="font-medium text-foreground/80">{settlementFrom.name}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-warm" />
                      <span className="font-medium text-foreground/80">{settlementTo.name}</span>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">All settled up</p>
                  )}
                </CardContent>
              </Card>
              </Link>
            </div>
          </div>

          {/* Per-user stat cards */}
          {user1 && user2 && (
            <div className="grid gap-5 sm:grid-cols-2 animate-fade-up stagger-2">
              {[
                { user: user1, paid: user1Paid, total: totalSpend, color: "bg-primary" },
                { user: user2, paid: user2Paid, total: totalSpend, color: "bg-warm" },
              ].map(({ user: u, paid, color }) => {
                const allUserTx = transactions.filter((t) => t.user_id === u.id);
                const userTotal = allUserTx.reduce((s, t) => s + Math.abs(t.amount), 0);
                return (
                  <Card key={u.id} className="group">
                    <CardContent className="pt-5 pb-5 px-6">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`h-2 w-2 rounded-full ${color}`} />
                          <span className="text-[13px] font-semibold tracking-tight">{u.name}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {allUserTx.length} txns
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-0.5">Total</p>
                          <span className="font-heading text-2xl font-bold">{formatCurrency(userTotal)}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-0.5">Shared</p>
                          <span className="font-mono text-lg font-medium text-muted-foreground">{formatCurrency(paid)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Category breakdown chart */}
          {chartData.length > 0 && (
            <div className="animate-fade-up stagger-3">
              <Card>
                <CardHeader className="pb-2 px-6 pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-1">
                        By Category
                      </p>
                      <CardTitle className="font-heading text-xl tracking-tight">
                        Spending Breakdown
                      </CardTitle>
                    </div>
                    <span className="font-mono text-sm text-muted-foreground">
                      {formatCurrency(totalSpend)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                  <div className="h-[300px] w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={chartData}
                        layout="vertical"
                        margin={{ left: 0, right: 16, top: 8, bottom: 0 }}
                        barCategoryGap="20%"
                      >
                        <XAxis
                          type="number"
                          tickFormatter={(v) => formatCompact(v)}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 11, fill: "oklch(0.52 0.015 60)" }}
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={100}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 12, fill: "oklch(0.35 0.02 50)" }}
                        />
                        <Tooltip
                          formatter={(value) => [formatCurrency(Number(value)), "Amount"]}
                          contentStyle={{
                            background: "oklch(0.99 0.004 85)",
                            border: "1px solid oklch(0.895 0.01 75)",
                            borderRadius: "8px",
                            boxShadow: "0 4px 12px oklch(0.5 0 0 / 0.08)",
                            fontSize: "13px",
                            fontFamily: "var(--font-sans)",
                          }}
                          cursor={{ fill: "oklch(0.5 0 0 / 0.04)" }}
                        />
                        <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={28}>
                          {chartData.map((_, index) => (
                            <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
