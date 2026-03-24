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

    const { data: settings, error } = await supabase
      .from("user_settings")
      .select("user_id, theme, updated_at, encrypted_api_key")
      .eq("user_id", appUser.id)
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to load settings" },
        { status: 500 }
      );
    }

    // Return the encrypted blob — client decrypts to check/display
    return NextResponse.json({
      user_id: settings.user_id,
      theme: settings.theme,
      updated_at: settings.updated_at,
      has_api_key: !!settings.encrypted_api_key,
      encrypted_api_key: settings.encrypted_api_key,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
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

    const body = await request.json();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.theme !== undefined) updates.theme = body.theme;

    // API key is now client-encrypted — stored as encrypted blob
    if ("encrypted_api_key" in body) {
      updates.encrypted_api_key = body.encrypted_api_key ?? null;
    }

    const { data: settings, error } = await supabase
      .from("user_settings")
      .update(updates)
      .eq("user_id", appUser.id)
      .select("user_id, theme, updated_at, encrypted_api_key")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to update settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...settings,
      has_api_key: !!settings.encrypted_api_key,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
