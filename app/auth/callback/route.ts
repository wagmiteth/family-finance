import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/onboarding";

  console.log("[auth/callback] params:", Object.fromEntries(searchParams));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    console.log("[auth/callback] exchangeCode error:", error);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  console.log("[auth/callback] no code or exchange failed, redirecting to /login");
  return NextResponse.redirect(`${origin}/login`);
}
