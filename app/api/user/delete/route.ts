import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
      .select("id, household_id")
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const admin = createAdminClient();
    const householdId = appUser.household_id;

    // Check how many members remain in the household
    let isLastMember = false;
    if (householdId) {
      const { count } = await admin
        .from("users")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      isLastMember = (count ?? 0) <= 1;
    }

    // --- Delete user-specific data ---

    // 1. user_key_material
    await admin
      .from("user_key_material")
      .delete()
      .eq("user_id", appUser.id);

    // 2. user_settings
    await admin
      .from("user_settings")
      .delete()
      .eq("user_id", appUser.id);

    // 3. Transactions owned by this user
    if (householdId) {
      await admin
        .from("transactions")
        .delete()
        .eq("user_id", appUser.id)
        .eq("household_id", householdId);
    }

    // 4. Categories owned by this user (personal categories)
    await admin
      .from("categories")
      .delete()
      .eq("owner_user_id", appUser.id);

    // --- If last member, delete entire household and all shared data ---
    if (isLastMember && householdId) {
      // Settlements (reference user IDs via from_user_id/to_user_id)
      await admin
        .from("settlements")
        .delete()
        .eq("household_id", householdId);

      // Remaining transactions (partner's, if any orphaned)
      await admin
        .from("transactions")
        .delete()
        .eq("household_id", householdId);

      // Merchant rules
      await admin
        .from("merchant_rules")
        .delete()
        .eq("household_id", householdId);

      // All categories (including system ones)
      await admin
        .from("categories")
        .delete()
        .eq("household_id", householdId);

      // Any remaining key material for the household
      await admin
        .from("user_key_material")
        .delete()
        .eq("household_id", householdId);
    }

    // 5. The user record itself
    await admin.from("users").delete().eq("id", appUser.id);

    // 6. Delete the household if last member
    if (isLastMember && householdId) {
      await admin.from("households").delete().eq("id", householdId);
    }

    // 7. Delete auth user
    await admin.auth.admin.deleteUser(authUser.id);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
