import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractSensitiveJson, SENSITIVE_KEYS } from "@/lib/transactions/encryption";

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).valueOf());
}

export async function GET(
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

    // Use RPC to get decrypted transaction
    const { data: transaction, error } = await supabase.rpc(
      "get_decrypted_transaction",
      {
        p_transaction_id: id,
        p_household_id: appUser.household_id,
      }
    );

    if (error || !transaction) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(transaction);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
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

    const body = await request.json();

    // Validate fields
    if ("description" in body) {
      const description =
        typeof body.description === "string" ? body.description.trim() : "";
      if (!description) {
        return NextResponse.json(
          { error: "description must be a non-empty string" },
          { status: 400 }
        );
      }
    }

    if ("amount" in body) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount)) {
        return NextResponse.json(
          { error: "amount must be a valid number" },
          { status: 400 }
        );
      }
    }

    if ("date" in body) {
      if (!isValidDate(body.date)) {
        return NextResponse.json(
          { error: "date must be a valid date string" },
          { status: 400 }
        );
      }
    }

    if ("user_id" in body) {
      const userId =
        typeof body.user_id === "string" && body.user_id.length > 0
          ? body.user_id
          : null;

      if (userId) {
        const { count: userCount, error: userError } = await supabase
          .from("users")
          .select("*", { count: "exact", head: true })
          .eq("id", userId)
          .eq("household_id", appUser.household_id);

        if (userError) {
          return NextResponse.json(
            { error: "Failed to update transaction" },
            { status: 500 }
          );
        }

        if ((userCount ?? 0) === 0) {
          return NextResponse.json(
            { error: "Selected user is not part of this household" },
            { status: 400 }
          );
        }
      }
    }

    if ("category_id" in body) {
      const categoryId =
        typeof body.category_id === "string" && body.category_id.length > 0
          ? body.category_id
          : null;

      if (categoryId) {
        const { count: categoryCount, error: categoryError } = await supabase
          .from("categories")
          .select("*", { count: "exact", head: true })
          .eq("id", categoryId)
          .eq("household_id", appUser.household_id);

        if (categoryError) {
          return NextResponse.json(
            { error: "Failed to update transaction" },
            { status: 500 }
          );
        }

        if ((categoryCount ?? 0) === 0) {
          return NextResponse.json(
            { error: "Selected category is not part of this household" },
            { status: 400 }
          );
        }
      }
    }

    // Separate non-sensitive updates from sensitive ones
    const nonSensitiveUpdates: Record<string, unknown> = {};
    const sensitiveUpdates: Record<string, string | null> = {};
    let hasSensitiveUpdates = false;

    // Non-sensitive fields
    for (const key of [
      "amount",
      "date",
      "user_id",
      "category_id",
      "transaction_type",
      "subcategory",
      "tags",
    ]) {
      if (key in body) {
        if (key === "tags") {
          nonSensitiveUpdates[key] = Array.isArray(body.tags)
            ? body.tags.filter(
                (tag: unknown): tag is string =>
                  typeof tag === "string" && tag.trim().length > 0
              )
            : null;
        } else if (key === "category_id" || key === "user_id") {
          nonSensitiveUpdates[key] =
            typeof body[key] === "string" && body[key].length > 0
              ? body[key]
              : null;
        } else if (key === "transaction_type" || key === "subcategory") {
          nonSensitiveUpdates[key] =
            typeof body[key] === "string" && body[key].length > 0
              ? body[key]
              : null;
        } else {
          nonSensitiveUpdates[key] = body[key];
        }
      }
    }

    if ("enriched_at" in body) {
      if (body.enriched_at === null || body.enriched_at === "") {
        nonSensitiveUpdates.enriched_at = null;
      } else if (isValidDate(body.enriched_at)) {
        nonSensitiveUpdates.enriched_at = new Date(
          body.enriched_at
        ).toISOString();
      } else {
        return NextResponse.json(
          { error: "enriched_at must be a valid date string" },
          { status: 400 }
        );
      }
    }

    // Sensitive fields
    for (const key of SENSITIVE_KEYS) {
      if (key in body) {
        hasSensitiveUpdates = true;
        if (key === "description") {
          sensitiveUpdates[key] =
            typeof body[key] === "string" ? body[key].trim() : "";
        } else {
          sensitiveUpdates[key] =
            typeof body[key] === "string" && body[key].length > 0
              ? body[key]
              : null;
        }
      }
    }

    if (
      Object.keys(nonSensitiveUpdates).length === 0 &&
      !hasSensitiveUpdates
    ) {
      return NextResponse.json(
        { error: "No valid fields provided for update" },
        { status: 400 }
      );
    }

    // If sensitive fields are being updated, fetch current values and merge
    let sensitiveJson: string | null = null;
    if (hasSensitiveUpdates) {
      const { data: existing } = await supabase.rpc(
        "get_decrypted_transaction",
        {
          p_transaction_id: id,
          p_household_id: appUser.household_id,
        }
      );

      if (!existing) {
        return NextResponse.json(
          { error: "Transaction not found" },
          { status: 404 }
        );
      }

      sensitiveJson = extractSensitiveJson(
        existing as Record<string, unknown>,
        sensitiveUpdates
      );
    }

    // Check if this is a V1 (client-encrypted) transaction
    const { data: currentTx } = await supabase
      .from("transactions")
      .select("encryption_version")
      .eq("id", id)
      .eq("household_id", appUser.household_id)
      .single();

    const isV1 = currentTx?.encryption_version === 1;

    if (isV1 && !hasSensitiveUpdates) {
      // V1 non-sensitive update: direct update (skip RPC which uses V0 pgcrypto)
      const { data: updated, error } = await supabase
        .from("transactions")
        .update({ ...nonSensitiveUpdates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("household_id", appUser.household_id)
        .select()
        .single();

      if (error || !updated) {
        console.error("[PATCH /api/transactions/id] V1 direct update:", error);
        return NextResponse.json(
          { error: "Failed to update transaction" },
          { status: 500 }
        );
      }

      return NextResponse.json(updated);
    }

    // V0 or sensitive update: use RPC with server-side encryption
    const { data: transaction, error } = await supabase.rpc(
      "update_encrypted_transaction",
      {
        p_id: id,
        p_household_id: appUser.household_id,
        p_updates: nonSensitiveUpdates,
        p_sensitive_json: sensitiveJson,
      }
    );

    if (error || !transaction) {
      console.error("[PATCH /api/transactions/id]", { error, transaction, nonSensitiveUpdates, sensitiveJson });
      return NextResponse.json(
        { error: "Failed to update transaction" },
        { status: 500 }
      );
    }

    return NextResponse.json(transaction);
  } catch (err) {
    console.error("[PATCH /api/transactions/id] catch:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

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

    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("id", id)
      .eq("household_id", appUser.household_id);

    if (error) {
      return NextResponse.json(
        { error: "Failed to delete transaction" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
