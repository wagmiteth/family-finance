import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/transactions/check-hashes
 * Accepts { hashes: string[] } and returns which ones already exist in the DB.
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

    const { data: appUser } = await supabase
      .from("users")
      .select()
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser?.household_id) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { hashes }: { hashes: string[] } = await request.json();

    if (!hashes || !Array.isArray(hashes) || hashes.length === 0) {
      return NextResponse.json({ existing: [], total: 0 });
    }

    const CHUNK = 100;
    const existing = new Set<string>();
    for (let i = 0; i < hashes.length; i += CHUNK) {
      const chunk = hashes.slice(i, i + CHUNK);
      const { data, error: hashError } = await supabase
        .from("transactions")
        .select("import_hash")
        .eq("household_id", appUser.household_id)
        .in("import_hash", chunk);
      if (hashError) {
        console.error("[check-hashes] chunk query error:", hashError);
        continue;
      }
      for (const row of data || []) {
        existing.add((row as { import_hash: string }).import_hash);
      }
    }

    // Also return total transaction count for the household
    const { count } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("household_id", appUser.household_id);

    return NextResponse.json({
      existing: [...existing],
      total: count ?? 0,
    });
  } catch (err) {
    console.error("[check-hashes]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
