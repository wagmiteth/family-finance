import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
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

    // Return ALL transactions for the household — client filters/sorts after decryption
    // Supabase defaults to 1000 rows; paginate to fetch everything
    const allTransactions: Record<string, unknown>[] = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data } = await supabase
        .from("transactions")
        .select()
        .eq("household_id", appUser.household_id)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      const rows = data ?? [];
      allTransactions.push(...rows);
      hasMore = rows.length === PAGE_SIZE;
      from += PAGE_SIZE;
    }

    return NextResponse.json(allTransactions);
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

    if (!appUser?.household_id) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await request.json();

    if (typeof body.encrypted_data !== "string") {
      return NextResponse.json(
        { error: "encrypted_data is required" },
        { status: 400 }
      );
    }

    if (typeof body.import_hash !== "string" || !body.import_hash) {
      return NextResponse.json(
        { error: "import_hash is required" },
        { status: 400 }
      );
    }

    const userId =
      typeof body.user_id === "string" && body.user_id.length > 0
        ? body.user_id
        : appUser.id;

    const categoryId =
      typeof body.category_id === "string" && body.category_id.length > 0
        ? body.category_id
        : null;

    const { data: transaction, error } = await supabase
      .from("transactions")
      .insert({
        household_id: appUser.household_id,
        user_id: userId,
        category_id: categoryId,
        import_hash: body.import_hash,
        encrypted_data: body.encrypted_data,
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
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
