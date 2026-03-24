import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateImportHash } from "@/lib/transactions/dedup";
import { buildSensitiveJson } from "@/lib/transactions/encryption";

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).valueOf());
}

export async function GET(request: NextRequest) {
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

    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get("month");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const userId = searchParams.get("userId");
    const categoryId = searchParams.get("categoryId");

    // Compute date range
    let startDate: string | null = null;
    let endDate: string | null = null;

    if (month) {
      startDate = `${month}-01`;
      const [year, m] = month.split("-").map(Number);
      endDate = new Date(year, m, 0).toISOString().split("T")[0];
    } else {
      startDate = from || null;
      endDate = to || null;
    }

    // Dual-mode: fetch transactions and handle decryption per version
    // V0 (server-encrypted): use RPC to decrypt server-side
    // V1 (client-encrypted): return raw encrypted_data for client decryption

    // First, get v0 transactions via server-side decryption RPC
    const { data: v0Transactions } = await supabase.rpc(
      "get_decrypted_transactions",
      {
        p_household_id: appUser.household_id,
        p_start_date: startDate,
        p_end_date: endDate,
        p_user_id: userId || null,
        p_category_id: categoryId || null,
      }
    );

    // Then get v1 transactions directly (raw encrypted_data)
    let v1Query = supabase
      .from("transactions")
      .select()
      .eq("household_id", appUser.household_id)
      .eq("encryption_version", 1)
      .order("date", { ascending: false });

    if (startDate) v1Query = v1Query.gte("date", startDate);
    if (endDate) v1Query = v1Query.lte("date", endDate);
    if (userId) v1Query = v1Query.eq("user_id", userId);
    if (categoryId) v1Query = v1Query.eq("category_id", categoryId);

    const { data: v1Transactions } = await v1Query;

    // Merge and sort by date descending
    const v0WithVersion = (v0Transactions ?? [])
      .filter((t: { encryption_version?: number }) => (t.encryption_version ?? 0) === 0)
      .map((t: Record<string, unknown>) => ({ ...t, encryption_version: 0 }));

    const all = [...v0WithVersion, ...(v1Transactions ?? [])].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return NextResponse.json(all);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
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

    const body = await request.json();
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const amount = Number(body.amount);
    const date = body.date;
    const userId =
      typeof body.user_id === "string" && body.user_id.length > 0
        ? body.user_id
        : appUser.id;
    const categoryId =
      typeof body.category_id === "string" && body.category_id.length > 0
        ? body.category_id
        : null;

    if (!appUser.household_id) {
      return NextResponse.json(
        { error: "User must belong to a household" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(amount) || !isValidDate(date)) {
      return NextResponse.json(
        { error: "amount and date are required" },
        { status: 400 }
      );
    }

    // Client-side encrypted: encrypted_data is provided as base64
    const isClientEncrypted = typeof body.encrypted_data === "string";

    if (!isClientEncrypted && !description) {
      return NextResponse.json(
        { error: "description is required" },
        { status: 400 }
      );
    }

    // Validate user and category membership
    const { count: userCount, error: userError } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("id", userId)
      .eq("household_id", appUser.household_id);

    if (userError || (userCount ?? 0) === 0) {
      return NextResponse.json(
        { error: "Selected user is not part of this household" },
        { status: 400 }
      );
    }

    if (categoryId) {
      const { count: categoryCount, error: categoryError } = await supabase
        .from("categories")
        .select("*", { count: "exact", head: true })
        .eq("id", categoryId)
        .eq("household_id", appUser.household_id);

      if (categoryError || (categoryCount ?? 0) === 0) {
        return NextResponse.json(
          { error: "Selected category is not part of this household" },
          { status: 400 }
        );
      }
    }

    const importHash =
      typeof body.import_hash === "string" && body.import_hash.length > 0
        ? body.import_hash
        : await generateImportHash(
            appUser.household_id,
            date,
            amount,
            description || "encrypted"
          );

    if (isClientEncrypted) {
      // V1: Client-side encryption — store the pre-encrypted blob directly
      const { data: transaction, error } = await supabase
        .from("transactions")
        .insert({
          household_id: appUser.household_id,
          user_id: userId,
          category_id: categoryId,
          date,
          amount,
          transaction_type:
            typeof body.transaction_type === "string"
              ? body.transaction_type
              : null,
          subcategory:
            typeof body.subcategory === "string" ? body.subcategory : null,
          tags: Array.isArray(body.tags)
            ? body.tags.filter(
                (tag: unknown): tag is string =>
                  typeof tag === "string" && tag.trim().length > 0
              )
            : null,
          import_hash: importHash,
          encrypted_data: body.encrypted_data,
          encryption_version: 1,
          enriched_at:
            typeof body.enriched_at === "string" && isValidDate(body.enriched_at)
              ? new Date(body.enriched_at).toISOString()
              : null,
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          { error: "Failed to create transaction" },
          { status: 500 }
        );
      }

      return NextResponse.json(transaction, { status: 201 });
    } else {
      // V0: Server-side encryption via RPC (legacy path)
      const sensitiveJson = buildSensitiveJson({
        description,
        bank_name: typeof body.bank_name === "string" ? body.bank_name : null,
        account_number:
          typeof body.account_number === "string" ? body.account_number : null,
        account_name:
          typeof body.account_name === "string" ? body.account_name : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        enriched_name:
          typeof body.enriched_name === "string" ? body.enriched_name : null,
        enriched_info:
          typeof body.enriched_info === "string" ? body.enriched_info : null,
        enriched_description:
          typeof body.enriched_description === "string"
            ? body.enriched_description
            : null,
        enriched_address:
          typeof body.enriched_address === "string"
            ? body.enriched_address
            : null,
      });

      const { data: transaction, error } = await supabase.rpc(
        "insert_encrypted_transaction",
        {
          p_household_id: appUser.household_id,
          p_user_id: userId,
          p_category_id: categoryId,
          p_date: date,
          p_amount: amount,
          p_transaction_type:
            typeof body.transaction_type === "string"
              ? body.transaction_type
              : null,
          p_subcategory:
            typeof body.subcategory === "string" ? body.subcategory : null,
          p_tags: Array.isArray(body.tags)
            ? body.tags.filter(
                (tag: unknown): tag is string =>
                  typeof tag === "string" && tag.trim().length > 0
              )
            : null,
          p_import_hash: importHash,
          p_sensitive_json: sensitiveJson,
          p_enriched_at:
            typeof body.enriched_at === "string" && isValidDate(body.enriched_at)
              ? new Date(body.enriched_at).toISOString()
              : null,
        }
      );

      if (error) {
        return NextResponse.json(
          { error: "Failed to create transaction" },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { ...transaction, encryption_version: 0 },
        { status: 201 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
