import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { extractSensitiveJson } from "@/lib/transactions/encryption";

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

    // Get encrypted API key from user_settings and decrypt it
    const { data: settings } = await supabase
      .from("user_settings")
      .select("encrypted_api_key")
      .eq("user_id", appUser.id)
      .single();

    if (!settings?.encrypted_api_key) {
      return NextResponse.json(
        { error: "Anthropic API key not configured in user settings" },
        { status: 400 }
      );
    }

    const { data: apiKey, error: decryptError } = await supabase.rpc(
      "decrypt_api_key",
      { ciphertext: settings.encrypted_api_key }
    );

    if (decryptError || !apiKey) {
      return NextResponse.json(
        { error: "Failed to decrypt API key" },
        { status: 500 }
      );
    }

    const { transactionIds, test, descriptions } = await request.json();
    // `descriptions` is an optional array of {id, name} for client-encrypted
    // transactions where the server cannot decrypt the descriptions.

    // Test mode: validate the API key with a minimal call
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

    // Fetch decrypted transactions via RPC
    const { data: allTransactions } = await supabase.rpc(
      "get_decrypted_transactions",
      {
        p_household_id: appUser.household_id,
        p_start_date: null,
        p_end_date: null,
        p_user_id: null,
        p_category_id: null,
      }
    );

    const transactions = (allTransactions ?? []).filter(
      (t: { id: string }) => transactionIds.includes(t.id)
    );

    if (transactions.length === 0) {
      return NextResponse.json(
        { error: "No transactions found" },
        { status: 404 }
      );
    }

    // Build prompt — use client-provided descriptions if available (v1 encrypted),
    // otherwise use server-decrypted descriptions (v0)
    const items: { id: string; name: string }[] = descriptions
      ? (descriptions as { id: string; name: string }[])
      : transactions.map((t: { id: string; description: string }) => ({
          id: t.id,
          name: t.description,
        }));

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
${items.map((t: { id: string; name: string }) => `- id: ${t.id}, name: "${t.name}"`).join("\n")}

Respond with ONLY a JSON array, no markdown, no code fences, no explanation. Example:
[{"id":"...","merchant_name":"...","merchant_type":"...","merchant_description":"...","merchant_address":"..."}]`,
        },
      ],
    });

    // Parse response — handle markdown code fences
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

    // For client-encrypted transactions (v1), return enrichment data
    // so the client can merge, re-encrypt, and update
    if (descriptions) {
      return NextResponse.json({
        enriched: enrichedData.length,
        failed: 0,
        results: enrichedData,
      });
    }

    // For server-encrypted transactions (v0), update directly
    const now = new Date().toISOString();
    const updates = await Promise.all(
      enrichedData.map(async (item) => {
        const existing = transactions.find(
          (t: { id: string }) => t.id === item.id
        );
        if (!existing) {
          return { id: item.id, success: false };
        }

        const sensitiveJson = extractSensitiveJson(
          existing as Record<string, unknown>,
          {
            enriched_name: item.merchant_name,
            enriched_info: item.merchant_type,
            enriched_description: item.merchant_description,
            enriched_address: item.merchant_address,
          }
        );

        const { error } = await supabase.rpc(
          "update_encrypted_transaction",
          {
            p_id: item.id,
            p_household_id: appUser.household_id,
            p_updates: { enriched_at: now },
            p_sensitive_json: sensitiveJson,
          }
        );

        return { id: item.id, success: !error };
      })
    );

    return NextResponse.json({
      enriched: updates.filter((u) => u.success).length,
      failed: updates.filter((u) => !u.success).length,
      details: updates,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
