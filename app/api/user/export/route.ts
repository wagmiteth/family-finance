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
      .select("id, household_id")
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser?.household_id) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Fetch all transactions for the household via RPC (decrypts v0)
    const { data: transactions, error } = await supabase.rpc(
      "get_decrypted_transactions",
      {
        p_household_id: appUser.household_id,
        p_start_date: null,
        p_end_date: null,
        p_user_id: null,
        p_category_id: null,
      }
    );

    if (error) {
      return NextResponse.json(
        { error: "Failed to export data" },
        { status: 500 }
      );
    }

    // Also fetch v1 transactions (raw encrypted — client must decrypt)
    const { data: v1Transactions } = await supabase
      .from("transactions")
      .select()
      .eq("household_id", appUser.household_id)
      .eq("encryption_version", 1)
      .order("date", { ascending: false });

    // Merge v0 (already decrypted) and v1 (raw)
    const v0 = (transactions ?? []).filter(
      (t: { encryption_version?: number }) => (t.encryption_version ?? 0) === 0
    );

    return NextResponse.json({
      transactions: [...v0, ...(v1Transactions ?? [])],
      exported_at: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
