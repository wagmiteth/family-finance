import { NextRequest, NextResponse } from "next/server";
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

    const { data: rules, error } = await supabase
      .from("merchant_rules")
      .select()
      .eq("household_id", appUser.household_id)
      .order("priority", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to load merchant rules" }, { status: 500 });
    }

    return NextResponse.json(rules);
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

    const { data: rule, error } = await supabase
      .from("merchant_rules")
      .insert({
        household_id: appUser.household_id,
        encrypted_data: body.encrypted_data,
        category_id: body.category_id ?? null,
        priority: body.priority ?? 0,
        is_learned: body.is_learned ?? false,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create merchant rule" }, { status: 500 });
    }

    return NextResponse.json(rule, { status: 201 });
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
      .select()
      .eq("auth_id", authUser.id)
      .single();

    if (!appUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if ("encrypted_data" in body) updates.encrypted_data = body.encrypted_data;
    if ("category_id" in body) updates.category_id = body.category_id;
    if ("priority" in body) updates.priority = body.priority;
    if ("is_learned" in body) updates.is_learned = body.is_learned;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields" }, { status: 400 });
    }

    const { data: rule, error } = await supabase
      .from("merchant_rules")
      .update(updates)
      .eq("id", id)
      .eq("household_id", appUser.household_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to update merchant rule" }, { status: 500 });
    }

    return NextResponse.json(rule);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
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

    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id query param is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("merchant_rules")
      .delete()
      .eq("id", id)
      .eq("household_id", appUser.household_id);

    if (error) {
      return NextResponse.json({ error: "Failed to delete merchant rule" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
