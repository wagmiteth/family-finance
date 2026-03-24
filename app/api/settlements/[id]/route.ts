import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Handle "adjustment acknowledged" — clears the settled snapshot to match current
    if (body.acknowledge_adjustment) {
      const { data: current } = await supabase
        .from("settlements")
        .select()
        .eq("id", id)
        .eq("household_id", appUser.household_id)
        .single();

      if (!current) {
        return NextResponse.json({ error: "Settlement not found" }, { status: 404 });
      }

      const { data: settlement, error } = await supabase
        .from("settlements")
        .update({
          settled_amount: current.amount,
          settled_from_user_id: current.from_user_id,
          settled_to_user_id: current.to_user_id,
        })
        .eq("id", id)
        .eq("household_id", appUser.household_id)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: "Failed to update settlement" }, { status: 500 });
      }

      return NextResponse.json(settlement);
    }

    const { is_settled } = body;

    // When marking as settled, snapshot the current amount and direction
    if (is_settled) {
      const { data: current } = await supabase
        .from("settlements")
        .select()
        .eq("id", id)
        .eq("household_id", appUser.household_id)
        .single();

      if (!current) {
        return NextResponse.json({ error: "Settlement not found" }, { status: 404 });
      }

      const { data: settlement, error } = await supabase
        .from("settlements")
        .update({
          is_settled: true,
          settled_at: new Date().toISOString(),
          settled_amount: current.amount,
          settled_from_user_id: current.from_user_id,
          settled_to_user_id: current.to_user_id,
        })
        .eq("id", id)
        .eq("household_id", appUser.household_id)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: "Failed to update settlement" }, { status: 500 });
      }

      return NextResponse.json(settlement);
    }

    // Marking as pending — clear snapshot
    const { data: settlement, error } = await supabase
      .from("settlements")
      .update({
        is_settled: false,
        settled_at: null,
        settled_amount: null,
        settled_from_user_id: null,
        settled_to_user_id: null,
      })
      .eq("id", id)
      .eq("household_id", appUser.household_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to update settlement" }, { status: 500 });
    }

    return NextResponse.json(settlement);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
