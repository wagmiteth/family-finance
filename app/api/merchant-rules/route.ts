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

    const { data: rule, error } = await supabase
      .from("merchant_rules")
      .insert({
        ...body,
        household_id: appUser.household_id,
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

    const { id, ...updates } = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: "id is required in body" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: "id query param is required" },
        { status: 400 }
      );
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
