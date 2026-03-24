import { NextResponse } from "next/server";

/**
 * Return a safe error response without leaking internal database details.
 * In development, the original message is included for debugging.
 */
export function safeError(
  fallback: string,
  status: number = 500
) {
  return NextResponse.json({ error: fallback }, { status });
}
