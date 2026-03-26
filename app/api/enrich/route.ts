import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

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

    const { transactionIds, test, descriptions, apiKey: clientApiKey } = await request.json();

    // Resolve API key: prefer client-provided, fall back to stored key
    let apiKey = clientApiKey;
    if (!apiKey) {
      const { data: settings } = await supabase
        .from("user_settings")
        .select("encrypted_api_key")
        .eq("user_id", appUser.id)
        .single();
      apiKey = settings?.encrypted_api_key;
    }

    if (typeof apiKey !== "string" || !apiKey) {
      return NextResponse.json(
        { error: "No API key configured. Add one in Settings." },
        { status: 400 }
      );
    }

    // Test mode: validate the API key
    if (test) {
      try {
        const anthropic = new Anthropic({ apiKey });
        await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 10,
          messages: [{ role: "user", content: "hi" }],
        });
        return NextResponse.json({ success: true, message: "API key is valid" });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Invalid API key";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return NextResponse.json(
        { error: "transactionIds array is required" },
        { status: 400 }
      );
    }

    if (!descriptions || !Array.isArray(descriptions)) {
      return NextResponse.json(
        { error: "descriptions array is required" },
        { status: 400 }
      );
    }

    const items = descriptions as { id: string; name: string; amount?: number }[];

    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are an expert at identifying merchants from bank transaction descriptions. These are Swedish bank transactions (amounts in SEK). For each transaction, identify the company/merchant and provide detailed information.

Return these fields for each transaction:
- merchant_name: The clean, human-readable company/merchant name (e.g. "Spotify" not "SPOTIFY AB")
- merchant_type: A specific category (e.g. "music streaming", "grocery store", "fast food restaurant", "cloud hosting provider", "public transit", "pharmacy", "home insurance", "mobile carrier", "coworking space", "SaaS / developer tools")
- merchant_description: 2-3 sentences. What the company does, what they're known for, when they were founded, and any notable details. Be specific — e.g. "Spotify is a Swedish music and podcast streaming service founded in 2006 by Daniel Ek and Martin Lorentzon. It is the world's largest audio streaming platform with over 600 million users." NOT just "A streaming service."
- merchant_address: The company's headquarters or primary location as "City, Country" (e.g. "Stockholm, Sweden"). If the transaction looks like a local store/restaurant, give the likely city. Use null only if truly unknown.

Transactions:
${items.map((t) => `- id: ${t.id}, name: "${t.name}"${t.amount != null ? `, amount: ${t.amount} SEK` : ""}`).join("\n")}

Respond with ONLY a valid JSON array. No markdown, no code fences, no explanation.
[{"id":"...","merchant_name":"...","merchant_type":"...","merchant_description":"...","merchant_address":"..."}]`,
        },
      ],
    });

    let responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    responseText = responseText.trim();
    if (responseText.startsWith("```")) {
      responseText = responseText.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    let enrichedData: Array<{
      id: string;
      merchant_name: string | null;
      merchant_type: string | null;
      merchant_description: string | null;
      merchant_address: string | null;
    }>;

    try {
      enrichedData = JSON.parse(responseText);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      enriched: enrichedData.length,
      failed: 0,
      results: enrichedData,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
