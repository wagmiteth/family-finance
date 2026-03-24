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

    // Return all settlement blobs — client decrypts and sorts
    const { data: settlements, error } = await supabase
      .from("settlements")
      .select()
      .eq("household_id", appUser.household_id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to load settlements" }, { status: 500 });
    }

    return NextResponse.json(settlements);
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

    const { data: appUser } = await supabase
      .from("users")
      .select()
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await request.json();

    if (typeof body.encrypted_data !== "string") {
      return NextResponse.json(
        { error: "encrypted_data is required" },
        { status: 400 }
      );
    }

    if (typeof body.settlement_hash !== "string") {
      return NextResponse.json(
        { error: "settlement_hash is required" },
        { status: 400 }
      );
    }

    // Upsert by settlement_hash (client-computed SHA-256 of household_id + month)
    const settlementPayload: Record<string, unknown> = {
      household_id: appUser.household_id,
      settlement_hash: body.settlement_hash,
      encrypted_data: body.encrypted_data,
      is_settled: body.is_settled ?? false,
    };

    if ("settled_at" in body) {
      settlementPayload.settled_at =
        typeof body.settled_at === "string" ? body.settled_at : null;
    }

    const { data: settlement, error } = await supabase
      .from("settlements")
      .upsert(
        settlementPayload,
        { onConflict: "household_id,settlement_hash" }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to create settlement" },
        { status: 500 }
      );
    }

    return NextResponse.json(settlement);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
