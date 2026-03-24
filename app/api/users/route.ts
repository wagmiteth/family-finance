import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    const { data: users, error } = await supabase
      .from("users")
      .select()
      .eq("household_id", appUser.household_id)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
    }

    return NextResponse.json(users);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
