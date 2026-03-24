import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    if (!appUser?.household_id) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      transactions,
      user_id,
    }: {
      transactions: { encrypted_data: string; import_hash: string; category_id?: string | null }[];
      user_id: string;
    } = body;

    const household_id = appUser.household_id;

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return NextResponse.json(
        { error: "transactions array is required" },
        { status: 400 }
      );
    }

    if (typeof user_id !== "string" || !user_id) {
      return NextResponse.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    // Validate all transactions have required fields
    const invalid = transactions.find(
      (t) => typeof t.encrypted_data !== "string" || typeof t.import_hash !== "string"
    );
    if (invalid) {
      return NextResponse.json(
        { error: "Each transaction must have encrypted_data and import_hash" },
        { status: 400 }
      );
    }

    // Check for duplicates by import_hash
    const hashes = transactions.map((t) => t.import_hash);
    const { data: existing } = await supabase
      .from("transactions")
      .select("import_hash")
      .eq("household_id", household_id)
      .in("import_hash", hashes);

    const existingHashes = new Set(
      (existing || []).map((e: { import_hash: string }) => e.import_hash)
    );

    const newTransactions = transactions.filter(
      (t) => !existingHashes.has(t.import_hash)
    );

    const duplicateCount = transactions.length - newTransactions.length;

    if (newTransactions.length === 0) {
      return NextResponse.json({
        imported: 0,
        duplicates: duplicateCount,
        transactions: [],
      });
    }

    // Create upload batch with encrypted file_names
    const { data: batch } = await supabase
      .from("upload_batches")
      .insert({
        household_id,
        user_id,
        uploaded_by: appUser.id,
        transaction_count: newTransactions.length,
        duplicate_count: duplicateCount,
        source: "client_encrypted",
        encrypted_data: typeof body.encrypted_batch === "string" ? body.encrypted_batch : null,
      })
      .select("id")
      .single();

    const batchId = batch?.id ?? null;

    const { data: inserted, error } = await supabase
      .from("transactions")
      .upsert(
        newTransactions.map((t) => ({
          household_id,
          user_id,
          category_id: t.category_id ?? null,
          import_hash: t.import_hash,
          encrypted_data: t.encrypted_data,
          batch_id: batchId,
        })),
        { onConflict: "household_id,import_hash", ignoreDuplicates: true }
      )
      .select();

    if (error) {
      return NextResponse.json(
        { error: "Failed to import transactions" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      imported: (inserted ?? []).length,
      duplicates: duplicateCount,
      transactions: inserted ?? [],
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

    // Bulk update category_id — batch in chunks to avoid URL length limits
    const CHUNK_SIZE = 200;
    let error = null;
    for (let i = 0; i < transactionIds.length; i += CHUNK_SIZE) {
      const chunk = transactionIds.slice(i, i + CHUNK_SIZE);
      const { error: chunkError } = await supabase
        .from("transactions")
        .update({
          category_id: category_id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("household_id", appUser.household_id)
        .in("id", chunk);
      if (chunkError) {
        error = chunkError;
        break;
      }
    }

    if (error) {
      console.error("[bulk PATCH] update error:", error);
      return NextResponse.json(
        { error: "Failed to update transactions" },
        { status: 500 }
      );
    }

    // Return updated rows — batch in chunks if many IDs (Supabase URL length limit)
    const updated: Record<string, unknown>[] = [];
    for (let i = 0; i < transactionIds.length; i += CHUNK_SIZE) {
      const chunk = transactionIds.slice(i, i + CHUNK_SIZE);
      const { data } = await supabase
        .from("transactions")
        .select()
        .eq("household_id", appUser.household_id)
        .in("id", chunk);
      if (data) updated.push(...data);
    }

    return NextResponse.json(updated ?? []);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
