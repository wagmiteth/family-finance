import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Update invite display fields (plaintext, for invite preview).
 * Only the household creator should call this.
 */
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
      .select("household_id")
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser?.household_id) {
      return NextResponse.json({ error: "No household" }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if ("invite_display_name" in body) updates.invite_display_name = body.invite_display_name;
    if ("invite_display_household" in body) updates.invite_display_household = body.invite_display_household;
    if ("invite_display_avatar" in body) updates.invite_display_avatar = body.invite_display_avatar;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields" }, { status: 400 });
    }

    const { error } = await supabase
      .from("households")
      .update(updates)
      .eq("id", appUser.household_id);

    if (error) {
      return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
