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

    if (body.split_ratio !== undefined) {
      const ratio = Number(body.split_ratio);
      if (!Number.isInteger(ratio) || ratio < 1 || ratio > 99) {
        return NextResponse.json(
          { error: "split_ratio must be between 1 and 99" },
          { status: 400 }
        );
      }
    }

    const { data: category, error } = await supabase
      .from("categories")
      .insert({
        ...body,
        household_id: appUser.household_id,
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

    // Bulk sort_order update: { order: [{ id, sort_order }] }
    if (body.order && Array.isArray(body.order)) {
      const updates = await Promise.all(
        body.order.map(
          async (item: { id: string; sort_order: number }) => {
            const { error } = await supabase
              .from("categories")
              .update({ sort_order: item.sort_order })
              .eq("id", item.id)
              .eq("household_id", appUser.household_id);
            return { id: item.id, error: error ? "Failed to update category" : undefined };
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

      return NextResponse.json({ success: true });
    }

    // Single category update
    if (body.split_ratio !== undefined) {
      const ratio = Number(body.split_ratio);
      if (!Number.isInteger(ratio) || ratio < 1 || ratio > 99) {
        return NextResponse.json(
          { error: "split_ratio must be between 1 and 99" },
          { status: 400 }
        );
      }
    }

    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: "id is required in body" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: "id query param is required" },
        { status: 400 }
      );
    }

    // Check if system category
    const { data: category } = await supabase
      .from("categories")
      .select("is_system")
      .eq("id", id)
      .eq("household_id", appUser.household_id)
      .single();

    if (!category) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 }
      );
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
