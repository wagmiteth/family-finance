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

    const { transactionIds, test, descriptions, apiKey } = await request.json();

    // API key is now provided by the client (decrypted client-side from encrypted blob)
    if (typeof apiKey !== "string" || !apiKey) {
      return NextResponse.json(
        { error: "apiKey is required (decrypted client-side)" },
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

    const items = descriptions as { id: string; name: string }[];

    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are given bank transaction names. For each one, identify what company or merchant it is and provide:
- merchant_name: The clean, human-readable company/merchant name
- merchant_type: A short category label (e.g. "cloud hosting", "grocery store", "streaming service", "restaurant", "telecom", "insurance")
- merchant_description: 1-2 sentences about what this company is and what they do. Be specific and informative.
- merchant_address: Their headquarters city/country if you know it, otherwise null

Transactions:
${items.map((t) => `- id: ${t.id}, name: "${t.name}"`).join("\n")}

Respond with ONLY a JSON array, no markdown, no code fences, no explanation. Example:
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
