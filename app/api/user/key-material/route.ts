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
      .select("id")
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { data: keyMaterial, error } = await supabase
      .from("user_key_material")
      .select("kdf_salt, kdf_iterations, wrapped_dek")
      .eq("user_id", appUser.id)
      .single();

    if (error || !keyMaterial) {
      return NextResponse.json(
        { error: "Key material not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      salt: keyMaterial.kdf_salt,
      iterations: keyMaterial.kdf_iterations,
      wrapped_dek: keyMaterial.wrapped_dek,
    });
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
      .select("id, household_id")
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!appUser.household_id) {
      return NextResponse.json(
        { error: "User must belong to a household" },
        { status: 400 }
      );
    }

    const { salt, iterations, wrapped_dek } = await request.json();

    if (!salt || !iterations || !wrapped_dek) {
      return NextResponse.json(
        { error: "salt, iterations, and wrapped_dek are required" },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("user_key_material").upsert(
      {
        user_id: appUser.id,
        household_id: appUser.household_id,
        kdf_salt: salt,
        kdf_iterations: iterations,
        wrapped_dek,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) {
      return NextResponse.json(
        { error: "Failed to save key material" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
