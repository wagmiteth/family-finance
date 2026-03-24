import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Verify batch belongs to this household
    const { data: batch, error: fetchError } = await supabase
      .from("upload_batches")
      .select("id, household_id")
      .eq("id", id)
      .eq("household_id", appUser.household_id)
      .single();

    if (fetchError || !batch) {
      return NextResponse.json(
        { error: "Upload batch not found" },
        { status: 404 }
      );
    }

    // Delete all transactions belonging to this batch
    const { error: txError } = await supabase
      .from("transactions")
      .delete()
      .eq("batch_id", id)
      .eq("household_id", appUser.household_id);

    if (txError) {
      console.error("[upload-batch DELETE] tx delete error:", txError);
      return NextResponse.json(
        { error: "Failed to delete batch transactions" },
        { status: 500 }
      );
    }

    // Delete the batch record
    const { error: batchError } = await supabase
      .from("upload_batches")
      .delete()
      .eq("id", id)
      .eq("household_id", appUser.household_id);

    if (batchError) {
      console.error("[upload-batch DELETE] batch delete error:", batchError);
      return NextResponse.json(
        { error: "Failed to delete upload batch" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[upload-batch DELETE]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
