"use client";

import { decryptFields, encryptFields } from "./entity-crypto";

const API_KEY_FIELD = "anthropic_api_key";

interface UserSettingsResponse {
  user_id: string;
  theme: string;
  updated_at: string;
  has_api_key: boolean;
  encrypted_api_key: string | null;
}

export async function encryptAnthropicApiKey(
  apiKey: string
): Promise<string> {
  const normalized = apiKey.trim();
  if (!normalized) {
    throw new Error("API key is required");
  }

  return encryptFields({ [API_KEY_FIELD]: normalized }, [API_KEY_FIELD]);
}

export async function decryptAnthropicApiKey(
  encryptedApiKey: string
): Promise<string> {
  const decrypted = await decryptFields(encryptedApiKey);
  const apiKey = decrypted[API_KEY_FIELD];

  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Stored API key is invalid");
  }

  return apiKey.trim();
}

export function maskAnthropicApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (normalized.length <= 11) {
    return `${normalized.slice(0, 4)}••••`;
  }

  return `${normalized.slice(0, 7)}••••${normalized.slice(-4)}`;
}

export async function fetchUserSettings(): Promise<UserSettingsResponse> {
  const res = await fetch("/api/user/settings", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to load settings");
  }

  return res.json() as Promise<UserSettingsResponse>;
}

export async function getStoredAnthropicApiKey(): Promise<string | null> {
  const settings = await fetchUserSettings();
  if (!settings.encrypted_api_key) {
    return null;
  }

  try {
    return await decryptAnthropicApiKey(settings.encrypted_api_key);
  } catch {
    throw new Error("Stored API key needs to be re-saved in Settings.");
  }
}

export async function getStoredAnthropicApiKeySummary(): Promise<{
  hasStoredKey: boolean;
  maskedKey: string | null;
  needsResave: boolean;
}> {
  const settings = await fetchUserSettings();
  if (!settings.encrypted_api_key) {
    return {
      hasStoredKey: false,
      maskedKey: null,
      needsResave: false,
    };
  }

  try {
    const apiKey = await decryptAnthropicApiKey(settings.encrypted_api_key);
    return {
      hasStoredKey: true,
      maskedKey: maskAnthropicApiKey(apiKey),
      needsResave: false,
    };
  } catch {
    return {
      hasStoredKey: true,
      maskedKey: null,
      needsResave: true,
    };
  }
}
