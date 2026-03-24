import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calculateSettlement } from "@/lib/settlements/calculator";
import type { Transaction, Category, User } from "@/lib/types";

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

    const { data: settlements, error } = await supabase
      .from("settlements")
      .select()
      .eq("household_id", appUser.household_id)
      .order("month", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to load settlements" }, { status: 500 });
    }

    return NextResponse.json(settlements);
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

    const { month } = await request.json();

    if (!month) {
      return NextResponse.json(
        { error: "month (YYYY-MM) is required" },
        { status: 400 }
      );
    }

    // Get all users in household
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select()
      .eq("household_id", appUser.household_id);

    if (usersError || !users || users.length < 2) {
      return NextResponse.json(
        { error: "Household needs 2 members for settlement" },
        { status: 400 }
      );
    }

    // Get categories
    const { data: categories } = await supabase
      .from("categories")
      .select()
      .eq("household_id", appUser.household_id);

    // Get transactions for the month
    const monthDate = `${month}-01`; // Full date for DB
    const [year, m] = month.split("-").map(Number);
    const endDate = new Date(year, m, 0).toISOString().split("T")[0];

    const { data: transactions } = await supabase.rpc(
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
      (transactions || []) as Transaction[],
      (categories || []) as Category[],
      users as [User, User]
    );

    // Upsert settlement
    const { data: settlement, error: upsertError } = await supabase
      .from("settlements")
      .upsert(
        {
          household_id: appUser.household_id,
          month: monthDate,
          from_user_id: result.fromUserId,
          to_user_id: result.toUserId,
          amount: result.amount,
          shared_total: result.sharedTotal,
        },
        { onConflict: "household_id,month" }
      )
      .select()
      .single();

    if (upsertError) {
      return NextResponse.json(
        { error: "Failed to create settlement" },
        { status: 500 }
      );
    }

    return NextResponse.json(settlement);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT — Recalculate settlement for a month (called after transaction moves)
// Preserves is_settled status and settled snapshot
export async function PUT(request: Request) {
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

    const { month } = await request.json();

    if (!month) {
      return NextResponse.json(
        { error: "month (YYYY-MM) is required" },
        { status: 400 }
      );
    }

    // Check if settlement exists for this month
    const monthDate = `${month}-01`;
    const { data: existing } = await supabase
      .from("settlements")
      .select()
      .eq("household_id", appUser.household_id)
      .eq("month", monthDate)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        { error: "No settlement found for this month" },
        { status: 404 }
      );
    }

    // Get users, categories, and transactions
    const { data: users } = await supabase
      .from("users")
      .select()
      .eq("household_id", appUser.household_id);

    if (!users || users.length < 2) {
      return NextResponse.json(
        { error: "Household needs 2 members" },
        { status: 400 }
      );
    }

    const { data: categories } = await supabase
      .from("categories")
      .select()
      .eq("household_id", appUser.household_id);

    const [year, m] = month.split("-").map(Number);
    const endDate = new Date(year, m, 0).toISOString().split("T")[0];

    const { data: transactions } = await supabase.rpc(
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
      (transactions || []) as Transaction[],
      (categories || []) as Category[],
      users as [User, User]
    );

    // Update the settlement amounts but preserve is_settled and settled snapshot
    const { data: settlement, error: updateError } = await supabase
      .from("settlements")
      .update({
        from_user_id: result.fromUserId,
        to_user_id: result.toUserId,
        amount: result.amount,
        shared_total: result.sharedTotal,
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to recalculate settlement" },
        { status: 500 }
      );
    }

    return NextResponse.json(settlement);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
