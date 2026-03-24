import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateImportHash } from "@/lib/transactions/dedup";
import { autoCategorize } from "@/lib/transactions/categorizer";
import { buildSensitiveJson } from "@/lib/transactions/encryption";
import type { ParsedTransaction, MerchantRule } from "@/lib/types";

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).valueOf());
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: appUser } = await supabase
      .from("users")
      .select()
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const {
      transactions: parsed,
      user_id,
    }: {
      transactions: ParsedTransaction[];
      user_id: string;
    } = await request.json();

    const household_id = appUser.household_id;

    if (!household_id) {
      return NextResponse.json(
        { error: "User must belong to a household" },
        { status: 400 }
      );
    }

    if (!parsed || !Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "transactions array is required" },
        { status: 400 }
      );
    }

    if (
      typeof user_id !== "string" ||
      user_id.length === 0
    ) {
      return NextResponse.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const invalidTransaction = parsed.find(
      (transaction) => {
        // Encrypted transactions have description inside encrypted_data
        const tx = transaction as unknown as Record<string, unknown>;
        const hasDescription = !!tx.encrypted_data || transaction.description?.trim();
        return (
          !hasDescription ||
          !Number.isFinite(transaction.amount) ||
          !isValidDate(transaction.date)
        );
      }
    );

    if (invalidTransaction) {
      return NextResponse.json(
        { error: "Each transaction must include a valid description, amount, and date" },
        { status: 400 }
      );
    }

    const { count: userCount, error: userError } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("id", user_id)
      .eq("household_id", household_id);

    if (userError) {
      return NextResponse.json({ error: "Failed to import transactions" }, { status: 500 });
    }

    if ((userCount ?? 0) === 0) {
      return NextResponse.json(
        { error: "Selected user is not part of this household" },
        { status: 400 }
      );
    }

    // Fetch merchant rules for auto-categorization
    const { data: rules, error: rulesError } = await supabase
      .from("merchant_rules")
      .select()
      .eq("household_id", household_id);

    if (rulesError) {
      return NextResponse.json({ error: "Failed to import transactions" }, { status: 500 });
    }

    const merchantRules: MerchantRule[] = rules || [];

    // Generate hashes and check for duplicates
    // For encrypted transactions, description is inside encrypted_data — use a fallback for hashing
    const transactionsWithHashes = await Promise.all(
      parsed.map(async (t) => {
        const tx = t as unknown as Record<string, unknown>;
        const desc = t.description || (tx.encrypted_data ? `enc_${String(tx.encrypted_data).slice(0, 32)}` : "");
        const import_hash = await generateImportHash(
          household_id,
          t.date,
          t.amount,
          desc
        );
        return { ...t, import_hash };
      })
    );

    // Get existing hashes
    const hashes = transactionsWithHashes.map((t) => t.import_hash);
    const { data: existing } = await supabase
      .from("transactions")
      .select("import_hash")
      .eq("household_id", household_id)
      .in("import_hash", hashes);

    const existingHashes = new Set(
      (existing || []).map((e) => e.import_hash)
    );

    // Check if client is sending pre-encrypted data
    const isClientEncrypted = parsed.length > 0 && typeof (parsed[0] as unknown as Record<string, unknown>).encrypted_data === "string";

    // Filter out duplicates and auto-categorize
    const newTransactions = transactionsWithHashes
      .filter((t) => !existingHashes.has(t.import_hash))
      .map((t) => {
        const categoryId = autoCategorize(
          t.description || "",
          t.amount,
          merchantRules
        );

        if (isClientEncrypted) {
          // V1: Client already encrypted — pass through
          return {
            household_id,
            user_id,
            date: t.date,
            amount: t.amount,
            transaction_type: t.transaction_type || null,
            subcategory: t.subcategory || null,
            tags: t.tags || null,
            import_hash: t.import_hash,
            category_id: categoryId,
            encrypted_data: (t as Record<string, unknown>).encrypted_data,
            encryption_version: 1,
          };
        }

        // V0: Build sensitive JSON for server-side encryption
        const sensitiveJson = buildSensitiveJson({
          description: t.description.trim(),
          bank_name: t.bank_name || null,
          account_number: t.account_number || null,
          account_name: t.account_name || null,
          notes: t.notes || null,
        });

        return {
          household_id,
          user_id,
          date: t.date,
          amount: t.amount,
          transaction_type: t.transaction_type || null,
          subcategory: t.subcategory || null,
          tags: t.tags || null,
          import_hash: t.import_hash,
          category_id: categoryId,
          sensitive_json: sensitiveJson,
        };
      });

    const duplicateCount = transactionsWithHashes.length - newTransactions.length;

    if (newTransactions.length === 0) {
      return NextResponse.json({
        imported: 0,
        duplicates: duplicateCount,
        transactions: [],
      });
    }

    let insertedArray: unknown[];

    if (isClientEncrypted) {
      // V1: Direct insert with pre-encrypted data
      const { data: inserted, error } = await supabase
        .from("transactions")
        .upsert(
          newTransactions.map((t) => ({
            household_id: t.household_id,
            user_id: t.user_id,
            category_id: t.category_id,
            date: t.date,
            amount: t.amount,
            transaction_type: t.transaction_type,
            subcategory: t.subcategory,
            tags: t.tags,
            import_hash: t.import_hash,
            encrypted_data: (t as Record<string, unknown>).encrypted_data,
            encryption_version: 1,
          })),
          { onConflict: "household_id,import_hash", ignoreDuplicates: true }
        )
        .select();

      if (error) {
        return NextResponse.json({ error: "Failed to import transactions" }, { status: 500 });
      }

      insertedArray = inserted ?? [];
    } else {
      // V0: Use RPC to bulk upsert with server-side encryption
      const { data: inserted, error } = await supabase.rpc(
        "upsert_encrypted_transactions",
        { p_transactions: newTransactions }
      );

      if (error) {
        return NextResponse.json({ error: "Failed to import transactions" }, { status: 500 });
      }

      insertedArray = inserted ?? [];
    }

    return NextResponse.json({
      imported: insertedArray.length,
      duplicates: duplicateCount,
      transactions: insertedArray,
    });
  } catch (err) {
    console.error("[bulk import]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: appUser } = await supabase
      .from("users")
      .select()
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const {
      transactionIds,
      category_id,
    }: { transactionIds: string[]; category_id: string | null } =
      await request.json();

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return NextResponse.json(
        { error: "transactionIds array is required" },
        { status: 400 }
      );
    }

    if (category_id) {
      const { count: categoryCount, error: categoryError } = await supabase
        .from("categories")
        .select("*", { count: "exact", head: true })
        .eq("id", category_id)
        .eq("household_id", appUser.household_id);

      if (categoryError) {
        return NextResponse.json(
          { error: "Failed to update transactions" },
          { status: 500 }
        );
      }

      if ((categoryCount ?? 0) === 0) {
        return NextResponse.json(
          { error: "Selected category is not part of this household" },
          { status: 400 }
        );
      }
    }

    // Fetch affected transactions to know their months (for settlement recalc)
    const { data: affectedTx } = await supabase
      .from("transactions")
      .select("id, date")
      .eq("household_id", appUser.household_id)
      .in("id", transactionIds);

    // Bulk update category_id (non-sensitive field, can use direct update)
    const { error } = await supabase
      .from("transactions")
      .update({
        category_id: category_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("household_id", appUser.household_id)
      .in("id", transactionIds);

    if (error) {
      return NextResponse.json({ error: "Failed to update transactions" }, { status: 500 });
    }

    // Return updated transactions with decrypted data
    const { data: updated } = await supabase.rpc(
      "get_decrypted_transactions",
      {
        p_household_id: appUser.household_id,
        p_start_date: null,
        p_end_date: null,
        p_user_id: null,
        p_category_id: null,
      }
    );

    // Filter to just the updated ones
    const updatedFiltered = (updated ?? []).filter(
      (t: { id: string }) => transactionIds.includes(t.id)
    );

    // Auto-recalculate settlements for affected months
    if (affectedTx && affectedTx.length > 0) {
      const affectedMonths = new Set(
        affectedTx.map((t) => t.date.slice(0, 7))
      );

      // Get users for calculation
      const { data: users } = await supabase
        .from("users")
        .select()
        .eq("household_id", appUser.household_id);

      const { data: categories } = await supabase
        .from("categories")
        .select()
        .eq("household_id", appUser.household_id);

      if (users && users.length >= 2 && categories) {
        const { calculateSettlement } = await import(
          "@/lib/settlements/calculator"
        );

        for (const month of affectedMonths) {
          const monthDate = `${month}-01`;

          // Check if settlement exists
          const { data: existing } = await supabase
            .from("settlements")
            .select()
            .eq("household_id", appUser.household_id)
            .eq("month", monthDate)
            .maybeSingle();

          if (!existing) continue;

          // Recalculate — fetch decrypted transactions for the month
          const [year, m] = month.split("-").map(Number);
          const endDate = new Date(year, m, 0).toISOString().split("T")[0];

          const { data: monthTx } = await supabase.rpc(
            "get_decrypted_transactions",
            {
              p_household_id: appUser.household_id,
              p_start_date: monthDate,
              p_end_date: endDate,
              p_user_id: null,
              p_category_id: null,
            }
          );

          const result = calculateSettlement(
            (monthTx || []) as import("@/lib/types").Transaction[],
            categories as import("@/lib/types").Category[],
            users as [import("@/lib/types").User, import("@/lib/types").User]
          );

          await supabase
            .from("settlements")
            .update({
              from_user_id: result.fromUserId,
              to_user_id: result.toUserId,
              amount: result.amount,
              shared_total: result.sharedTotal,
            })
            .eq("id", existing.id);
        }
      }
    }

    return NextResponse.json(updatedFiltered);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
