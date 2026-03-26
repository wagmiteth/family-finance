import type { Category } from "@/lib/types";

export function isDeletedCategory(
  category: Pick<Category, "name"> | null | undefined
): boolean {
  return category?.name === "deleted";
}

export function excludeDeletedCategory<T extends Pick<Category, "name">>(
  categories: T[]
): T[] {
  return categories.filter((category) => !isDeletedCategory(category));
}
