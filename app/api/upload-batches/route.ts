import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * DELETE /api/upload-batches
 * Deletes ALL transactions and ALL upload batches for the household.
 * Used for a clean re-import.
 */
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
      .select()
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser?.household_id) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const hid = appUser.household_id;

    // Delete all transactions first (FK constraint)
    const { error: txErr } = await supabase
      .from("transactions")
      .delete()
      .eq("household_id", hid);

    if (txErr) {
      console.error("[upload-batches DELETE all] tx error:", txErr);
      return NextResponse.json({ error: "Failed to delete transactions" }, { status: 500 });
    }

    // Delete all batches
    const { error: batchErr } = await supabase
      .from("upload_batches")
      .delete()
      .eq("household_id", hid);

    if (batchErr) {
      console.error("[upload-batches DELETE all] batch error:", batchErr);
      return NextResponse.json({ error: "Failed to delete batches" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[upload-batches DELETE all]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
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
