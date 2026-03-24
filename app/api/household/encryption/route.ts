import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** GET: Retrieve the invite-code-wrapped DEK for key exchange during join */
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
      .select("household_id")
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser?.household_id) {
      return NextResponse.json(
        { error: "Household not found" },
        { status: 404 }
      );
    }

    const { data: household, error } = await supabase
      .from("households")
      .select("encrypted_dek, invite_code_salt")
      .eq("id", appUser.household_id)
      .single();

    if (error || !household) {
      return NextResponse.json(
        { error: "Failed to load household encryption" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      encrypted_dek: household.encrypted_dek,
      invite_code_salt: household.invite_code_salt,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** POST: Store the invite-code-wrapped DEK (called by household creator) */
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
      .select("household_id")
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser?.household_id) {
      return NextResponse.json(
        { error: "Household not found" },
        { status: 404 }
      );
    }

    const { encrypted_dek, invite_code_salt } = await request.json();

    if (!encrypted_dek || !invite_code_salt) {
      return NextResponse.json(
        { error: "encrypted_dek and invite_code_salt are required" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("households")
      .update({ encrypted_dek, invite_code_salt })
      .eq("id", appUser.household_id);

    if (error) {
      return NextResponse.json(
        { error: "Failed to store encryption keys" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** DELETE: Clear the invite-code-wrapped DEK after partner joins */
export async function DELETE() {
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
      return NextResponse.json(
        { error: "Household not found" },
        { status: 404 }
      );
    }

    await supabase
      .from("households")
      .update({ encrypted_dek: null, invite_code_salt: null })
      .eq("id", appUser.household_id);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
