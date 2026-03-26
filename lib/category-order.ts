export function getCategoryOrderMarkerKey(householdId: string): string {
  return `ff-category-order-customized:${householdId}`;
}

export function hasCategoryOrderMarker(householdId: string): boolean {
  try {
    return localStorage.getItem(getCategoryOrderMarkerKey(householdId)) === "1";
  } catch {
    return false;
  }
}

export function setCategoryOrderMarker(householdId: string): void {
  try {
    localStorage.setItem(getCategoryOrderMarkerKey(householdId), "1");
  } catch {
    // ignore localStorage failures
  }
}
