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

    const { data: categories, error } = await supabase
      .from("categories")
      .select()
      .eq("household_id", appUser.household_id)
      .order("sort_order", { ascending: true });

    if (error) {
      return NextResponse.json({ error: "Failed to load categories" }, { status: 500 });
    }

    return NextResponse.json(categories);
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

    const { data: category, error } = await supabase
      .from("categories")
      .insert({
        household_id: appUser.household_id,
        owner_user_id: body.owner_user_id ?? null,
        sort_order: body.sort_order ?? 0,
        is_system: body.is_system ?? false,
        encrypted_data: body.encrypted_data,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
    }

    return NextResponse.json(category, { status: 201 });
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

    // Bulk sort_order update
    if (body.order && Array.isArray(body.order)) {
      const updates = await Promise.all(
        body.order.map(
          async (item: { id: string; sort_order: number }) => {
            const { error } = await supabase
              .from("categories")
              .update({ sort_order: item.sort_order })
              .eq("id", item.id)
              .eq("household_id", appUser.household_id);
            return { id: item.id, error: error ? "Failed" : undefined };
          }
        )
      );

      const failed = updates.filter((u: { error?: string }) => u.error);
      if (failed.length > 0) {
        return NextResponse.json(
          { error: "Some updates failed", details: failed },
          { status: 500 }
        );
      }

      const { error: householdError } = await supabase
        .from("households")
        .update({ category_order_customized: true })
        .eq("id", appUser.household_id);

      if (householdError) {
        console.warn(
          "[categories PATCH order] category order flag not persisted:",
          householdError.message
        );
      }

      return NextResponse.json({
        success: true,
        category_order_customized_persisted: !householdError,
      });
    }

    // Single category update — only server-stored fields
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if ("owner_user_id" in body) updates.owner_user_id = body.owner_user_id;
    if ("sort_order" in body) updates.sort_order = body.sort_order;
    if ("encrypted_data" in body) updates.encrypted_data = body.encrypted_data;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields" }, { status: 400 });
    }

    const { data: category, error } = await supabase
      .from("categories")
      .update(updates)
      .eq("id", id)
      .eq("household_id", appUser.household_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
    }

    return NextResponse.json(category);
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

    const { data: category } = await supabase
      .from("categories")
      .select("is_system")
      .eq("id", id)
      .eq("household_id", appUser.household_id)
      .single();

    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    if (category.is_system) {
      return NextResponse.json(
        { error: "Cannot delete system categories" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("categories")
      .delete()
      .eq("id", id)
      .eq("household_id", appUser.household_id);

    if (error) {
      return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
