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

/**
 * Create a new household with encrypted data.
 *
 * The client must provide:
 * - encrypted_household: encrypted { name }
 * - encrypted_user: encrypted { name, avatar_url }
 * - encrypted_categories: array of { encrypted_data, owner_user_id?, sort_order, is_system }
 * - encrypted_merchant_rules: array of { encrypted_data, category_index?, priority, is_learned }
 *
 * category_index in merchant_rules refers to the index in encrypted_categories array,
 * so the server can link the rule to the correct category after insert.
 */
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

    if (typeof body.encrypted_household !== "string") {
      return NextResponse.json(
        { error: "encrypted_household is required" },
        { status: 400 }
      );
    }

    if (typeof body.encrypted_user !== "string") {
      return NextResponse.json(
        { error: "encrypted_user is required" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Check if user already has a profile with a household
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

    // Create household
    const inviteCode = generateInviteCode();
    const inviteExpiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: household, error: householdError } = await admin
      .from("households")
      .insert({
        invite_code: inviteCode,
        invite_expires_at: inviteExpiresAt,
        encrypted_data: body.encrypted_household,
        // Plaintext display fields for invite preview (visible to invite code holders)
        invite_display_name: typeof body.invite_display_name === "string" ? body.invite_display_name : null,
        invite_display_household: typeof body.invite_display_household === "string" ? body.invite_display_household : null,
        invite_display_avatar: typeof body.invite_display_avatar === "string" ? body.invite_display_avatar : null,
      })
      .select()
      .single();

    if (householdError) {
      return NextResponse.json(
        { error: "Failed to create household" },
        { status: 500 }
      );
    }

    // Create or update user
    const userPayload = {
      household_id: household.id,
      email: authUser.email,
      encrypted_data: body.encrypted_user,
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

    // Create encrypted categories
    if (Array.isArray(body.encrypted_categories)) {
      const categoryRows = body.encrypted_categories.map(
        (cat: {
          encrypted_data: string;
          owner_is_self?: boolean;
          sort_order?: number;
          is_system?: boolean;
        }) => ({
          household_id: household.id,
          encrypted_data: cat.encrypted_data,
          owner_user_id: cat.owner_is_self ? user.id : null,
          sort_order: cat.sort_order ?? 0,
          is_system: cat.is_system ?? false,
        })
      );

      const { data: insertedCategories, error: categoriesError } = await admin
        .from("categories")
        .insert(categoryRows)
        .select("id");

      if (categoriesError) {
        return NextResponse.json(
          { error: "Failed to create categories" },
          { status: 500 }
        );
      }

      // Create encrypted merchant rules (link to categories by index)
      if (
        Array.isArray(body.encrypted_merchant_rules) &&
        insertedCategories
      ) {
        const ruleRows = body.encrypted_merchant_rules.map(
          (rule: {
            encrypted_data: string;
            category_index?: number;
            priority?: number;
            is_learned?: boolean;
          }) => ({
            household_id: household.id,
            encrypted_data: rule.encrypted_data,
            category_id:
              rule.category_index != null
                ? insertedCategories[rule.category_index]?.id ?? null
                : null,
            priority: rule.priority ?? 0,
            is_learned: rule.is_learned ?? false,
          })
        );

        await admin.from("merchant_rules").insert(ruleRows);
      }
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
