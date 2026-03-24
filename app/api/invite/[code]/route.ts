import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public endpoint — returns invite display info for the login/onboarding UI.
 * Uses plaintext invite_display_* fields set during household creation.
 * These fields are only visible to someone who has the invite code.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const normalized = code.trim().toUpperCase();
    const admin = createAdminClient();

    const { data: household } = await admin
      .from("households")
      .select("id, invite_code, invite_display_name, invite_display_household, invite_display_avatar")
      .eq("invite_code", normalized)
      .is("invite_used_at", null)
      .single();

    if (!household) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    return NextResponse.json({
      household_name: household.invite_display_household || "A household",
      inviter_name: household.invite_display_name || "Someone",
      inviter_avatar_url: household.invite_display_avatar || null,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
