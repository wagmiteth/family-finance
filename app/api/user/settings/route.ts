import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function maskApiKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 12) return "••••••••";
  return key.slice(0, 7) + "••••" + key.slice(-4);
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
      .select("id")
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Fetch settings and decrypt the API key server-side
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

    // Decrypt the key to check if it exists, but only return a masked version
    let hasApiKey = false;
    let maskedApiKey: string | null = null;

    if (settings.encrypted_api_key) {
      const { data: decrypted } = await supabase.rpc("decrypt_api_key", {
        ciphertext: settings.encrypted_api_key,
      });
      if (decrypted) {
        hasApiKey = true;
        maskedApiKey = maskApiKey(decrypted);
      }
    }

    return NextResponse.json({
      user_id: settings.user_id,
      theme: settings.theme,
      updated_at: settings.updated_at,
      has_api_key: hasApiKey,
      masked_api_key: maskedApiKey,
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

    // Handle API key: encrypt before storing
    if (body.anthropic_api_key !== undefined) {
      if (body.anthropic_api_key === null || body.anthropic_api_key === "") {
        // Clear the key
        updates.encrypted_api_key = null;
      } else {
        // Encrypt the new key using the database function
        const { data: encrypted, error: encryptError } = await supabase.rpc(
          "encrypt_api_key",
          { plaintext: body.anthropic_api_key }
        );
        if (encryptError) {
          return NextResponse.json(
            { error: "Failed to encrypt API key" },
            { status: 500 }
          );
        }
        updates.encrypted_api_key = encrypted;
      }
    }

    const { data: settings, error } = await supabase
      .from("user_settings")
      .update(updates)
      .eq("user_id", appUser.id)
      .select("user_id, theme, updated_at")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to update settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...settings,
      has_api_key: body.anthropic_api_key !== null && body.anthropic_api_key !== "",
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
