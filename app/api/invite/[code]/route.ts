import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public endpoint — returns non-sensitive invite info for OG previews
 * and the login page invite banner. No auth required.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const normalized = code.trim().toUpperCase();
    const admin = createAdminClient();

    // Find household by invite code
    const { data: household } = await admin
      .from("households")
      .select("id, name, invite_code")
      .eq("invite_code", normalized)
      .is("invite_used_at", null)
      .single();

    if (!household) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    // Find the household creator (first member)
    const { data: members } = await admin
      .from("users")
      .select("name, avatar_url")
      .eq("household_id", household.id)
      .order("created_at", { ascending: true })
      .limit(1);

    const inviter = members?.[0];

    return NextResponse.json({
      household_name: household.name,
      inviter_name: inviter?.name || "Someone",
      inviter_avatar_url: inviter?.avatar_url || null,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
