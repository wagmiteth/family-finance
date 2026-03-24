import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import crypto from "crypto";

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  let code = "";
  for (let i = 0; i < 12; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

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

    const [{ data: household, error: householdError }, { data: members, error: membersError }] =
      await Promise.all([
        supabase
          .from("households")
          .select()
          .eq("id", appUser.household_id)
          .single(),
        supabase
          .from("users")
          .select()
          .eq("household_id", appUser.household_id)
          .order("created_at", { ascending: true }),
      ]);

    if (householdError || !household) {
      return NextResponse.json(
        { error: "Failed to load household" },
        { status: householdError ? 500 : 404 }
      );
    }

    if (membersError) {
      return NextResponse.json(
        { error: "Failed to load household members" },
        { status: 500 }
      );
    }

    return NextResponse.json({ household, members: members ?? [] });
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

    const { householdName, userName } = await request.json();

    const name =
      typeof householdName === "string" && householdName.trim().length > 0
        ? householdName.trim()
        : "My Household";

    // Use admin client to bypass RLS for onboarding
    const admin = createAdminClient();

    // Check if user already has a profile
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

    // Create household with invite code that expires in 7 days
    const inviteCode = generateInviteCode();
    const inviteExpiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { data: household, error: householdError } = await admin
      .from("households")
      .insert({
        name,
        invite_code: inviteCode,
        invite_expires_at: inviteExpiresAt,
      })
      .select()
      .single();

    if (householdError) {
      return NextResponse.json(
        { error: "Failed to create household" },
        { status: 500 }
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

    // Create default categories
    const defaultCategories = [
      {
        household_id: household.id,
        name: "uncategorized",
        display_name: "📋 Uncategorized",
        split_type: "none",
        color: "#9ca3af",
        is_system: true,
        sort_order: 0,
      },
      {
        household_id: household.id,
        name: "shared",
        display_name: "🤝 Shared",
        split_type: "equal",
        color: "#2b9a8f",
        is_system: true,
        sort_order: 1,
      },
      {
        household_id: household.id,
        name: "private",
        display_name: `👤 ${displayName} - Private`,
        split_type: "full_payer",
        owner_user_id: user.id,
        color: "#4a7c59",
        is_system: false,
        sort_order: 2,
      },
      {
        household_id: household.id,
        name: "work",
        display_name: `💼 ${displayName} - Work`,
        split_type: "full_payer",
        owner_user_id: user.id,
        color: "#6a9e78",
        is_system: false,
        sort_order: 3,
      },
      {
        household_id: household.id,
        name: "exclude",
        display_name: "🚫 Exclude",
        split_type: "none",
        color: "#78716c",
        is_system: true,
        sort_order: 4,
      },
      {
        household_id: household.id,
        name: "deleted",
        display_name: "🗑️ Deleted",
        split_type: "none",
        color: "#dc2626",
        is_system: true,
        sort_order: 99,
      },
    ];

    const { error: categoriesError } = await admin
      .from("categories")
      .insert(defaultCategories);

    if (categoriesError) {
      return NextResponse.json(
        { error: "Failed to create default categories" },
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
