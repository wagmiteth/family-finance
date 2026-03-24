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
      .select()
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Return raw batches — user names are encrypted, client joins them
    const { data: batches, error } = await supabase
      .from("upload_batches")
      .select("*")
      .eq("household_id", appUser.household_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[upload-batches GET]", error);
      return NextResponse.json(
        { error: "Failed to fetch upload history" },
        { status: 500 }
      );
    }

    return NextResponse.json(batches);
  } catch (err) {
    console.error("[upload-batches GET]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
