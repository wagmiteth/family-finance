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

    const { inviteCode, userName } = await request.json();

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

    const displayName =
      typeof userName === "string" && userName.trim().length > 0
        ? userName.trim()
        : existingUser?.name ||
          authUser.user_metadata?.name ||
          authUser.email?.split("@")[0] ||
          "User";

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
      // Return same error for not-found and expired to avoid leaking info
      return NextResponse.json(
        { error: "Invalid or expired invite code" },
        { status: 404 }
      );
    }

    // Check if invite code has expired
    if (household.invite_expires_at) {
      const expiresAt = new Date(household.invite_expires_at);
      if (expiresAt < new Date()) {
        return NextResponse.json(
          { error: "Invalid or expired invite code" },
          { status: 404 }
        );
      }
    }

    // Check if invite code was already used
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

    const userPayload = {
      household_id: household.id,
      email: authUser.email,
      name: displayName,
    };

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

    // Create Private + Work categories for the joining user
    const userCategories = [
      {
        household_id: household.id,
        name: "private",
        display_name: `👤 ${displayName} - Private`,
        split_type: "full_payer",
        owner_user_id: user.id,
        color: "#b45a3c",
        is_system: false,
        sort_order: 5,
      },
      {
        household_id: household.id,
        name: "work",
        display_name: `💼 ${displayName} - Work`,
        split_type: "full_payer",
        owner_user_id: user.id,
        color: "#d4845a",
        is_system: false,
        sort_order: 6,
      },
    ];

    const { error: categoriesError } = await admin
      .from("categories")
      .insert(userCategories);

    if (categoriesError) {
      return NextResponse.json(
        { error: "Failed to create categories" },
        { status: 500 }
      );
    }

    // Create user_settings
    const { error: settingsError } = await admin
      .from("user_settings")
      .insert({ user_id: user.id });

    if (settingsError) {
      return NextResponse.json(
        { error: "Failed to create user settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({ household, user }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
