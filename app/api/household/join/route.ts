import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const inviteCode = body.inviteCode;
    const normalizedInviteCode =
      typeof inviteCode === "string" ? inviteCode.trim().toUpperCase() : "";

    if (!normalizedInviteCode) {
      return NextResponse.json(
        { error: "inviteCode is required" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    const { data: existingUser } = await admin
      .from("users")
      .select()
      .eq("auth_id", authUser.id)
      .maybeSingle();

    if (existingUser?.household_id) {
      return NextResponse.json(
        { error: "User already belongs to a household" },
        { status: 400 }
      );
    }

    // Look up household by invite code
    const { data: household, error: householdError } = await admin
      .from("households")
      .select()
      .eq("invite_code", normalizedInviteCode)
      .single();

    if (householdError || !household) {
      return NextResponse.json(
        { error: "Invalid or expired invite code" },
        { status: 404 }
      );
    }

    // Check expiry
    if (household.invite_expires_at) {
      const expiresAt = new Date(household.invite_expires_at);
      if (expiresAt < new Date()) {
        return NextResponse.json(
          { error: "Invalid or expired invite code" },
          { status: 404 }
        );
      }
    }

    // Check if already used
    if (household.invite_used_at) {
      return NextResponse.json(
        { error: "This invite code has already been used" },
        { status: 400 }
      );
    }

    // Check max 2 users
    const { count, error: countError } = await admin
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("household_id", household.id);

    if (countError) {
      return NextResponse.json(
        { error: "Failed to verify household" },
        { status: 500 }
      );
    }

    if ((count ?? 0) >= 2) {
      return NextResponse.json(
        { error: "Household already has 2 members" },
        { status: 400 }
      );
    }

    // Create or update user — encrypted_data provided by client
    const userPayload: Record<string, unknown> = {
      household_id: household.id,
      email: authUser.email,
    };

    if (typeof body.encrypted_user === "string") {
      userPayload.encrypted_data = body.encrypted_user;
    }

    const userQuery = existingUser
      ? admin
          .from("users")
          .update(userPayload)
          .eq("auth_id", authUser.id)
          .select()
          .single()
      : admin
          .from("users")
          .insert({
            auth_id: authUser.id,
            ...userPayload,
          })
          .select()
          .single();

    const { data: user, error: userError } = await userQuery;

    if (userError) {
      console.error("[join] user create error:", userError);
      return NextResponse.json(
        { error: "Failed to create user profile" },
        { status: 500 }
      );
    }

    // Mark invite code as used
    await admin
      .from("households")
      .update({ invite_used_at: new Date().toISOString() })
      .eq("id", household.id);

    // Create encrypted categories for the joining user (provided by client)
    if (Array.isArray(body.encrypted_categories)) {
      const categoryRows = body.encrypted_categories.map(
        (cat: {
          encrypted_data: string;
          sort_order?: number;
          is_system?: boolean;
        }) => ({
          household_id: household.id,
          encrypted_data: cat.encrypted_data,
          owner_user_id: user.id,
          sort_order: cat.sort_order ?? 5,
          is_system: cat.is_system ?? false,
        })
      );

      await admin.from("categories").insert(categoryRows);
    }

    // Create user_settings
    await admin.from("user_settings").insert({ user_id: user.id });

    return NextResponse.json({ household, user }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
