// ============================================================
// Client-side types — these represent DECRYPTED data in the browser.
// The server only stores encrypted_data blobs + UUIDs + timestamps.
// ============================================================

// --- Core entities (decrypted view) ---

export interface Household {
  id: string;
  name: string; // encrypted
  invite_code: string | null;
  created_at: string;
}

export interface User {
  id: string;
  auth_id: string;
  household_id: string | null;
  email: string;
  name: string; // encrypted
  avatar_url: string | null; // encrypted
  created_at: string;
}

export interface Category {
  id: string;
  household_id: string;
  name: string; // encrypted
  display_name: string; // encrypted
  description: string | null; // encrypted
  split_type: "equal" | "full_payer" | "none"; // encrypted
  split_ratio: number; // encrypted
  owner_user_id: string | null;
  color: string | null; // encrypted
  sort_order: number;
  is_system: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  household_id: string;
  user_id: string | null;
  category_id: string | null;
  description: string; // encrypted
  amount: number; // encrypted
  date: string; // encrypted
  transaction_type: string | null; // encrypted
  subcategory: string | null; // encrypted
  tags: string[] | null; // encrypted
  notes: string | null; // encrypted
  bank_name: string | null; // encrypted
  account_number: string | null; // encrypted
  account_name: string | null; // encrypted
  enriched_name: string | null; // encrypted
  enriched_info: string | null; // encrypted
  enriched_description: string | null; // encrypted
  enriched_address: string | null; // encrypted
  enriched_at: string | null; // encrypted
  import_hash: string;
  batch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantRule {
  id: string;
  household_id: string;
  pattern: string; // encrypted
  category_id: string | null;
  merchant_name: string | null; // encrypted
  merchant_type: string | null; // encrypted
  amount_hint: number | null; // encrypted
  amount_max: number | null; // encrypted
  priority: number;
  is_learned: boolean;
  rule_type: "auto_import" | "pattern"; // encrypted
  match_transaction_type: string | null; // encrypted
  notes: string | null; // encrypted
  created_at: string;
}

export interface SettlementTransactionSnapshot {
  id: string;
  user_id: string | null;
  category_id: string | null;
  description: string;
  enriched_name: string | null;
  amount: number;
  date: string;
  created_at: string;
}

export interface SettlementUserSummary {
  userId: string;
  paid: number;
  owes: number;
  net: number;
}

export interface SettlementCategorySummary {
  categoryId: string;
  categoryName: string;
  splitType: "equal" | "full_payer";
  total: number;
  transactionCount: number;
  paidByUser: Record<string, number>;
  owesByUser: Record<string, number>;
}

export interface SettlementBatch {
  id: string;
  settled_at: string;
  amount: number;
  shared_total: number | null;
  from_user_id: string | null;
  to_user_id: string | null;
  users: SettlementUserSummary[];
  categories: SettlementCategorySummary[];
  transactions: SettlementTransactionSnapshot[];
}

export interface Settlement {
  id: string;
  household_id: string;
  settlement_hash: string;
  month: string; // encrypted
  from_user_id: string | null; // encrypted
  to_user_id: string | null; // encrypted
  amount: number; // encrypted
  shared_total: number | null; // encrypted
  is_settled: boolean;
  settled_at: string | null;
  settled_amount: number | null; // encrypted
  settled_from_user_id: string | null; // encrypted
  settled_to_user_id: string | null; // encrypted
  settled_users: SettlementUserSummary[] | null; // encrypted
  settled_categories: SettlementCategorySummary[] | null; // encrypted
  settled_transactions: SettlementTransactionSnapshot[] | null; // encrypted
  settlement_batches: SettlementBatch[] | null; // encrypted
  notes: string | null; // encrypted
  created_at: string;
}

export interface UserSettings {
  user_id: string;
  has_api_key: boolean;
  masked_api_key: string | null;
  theme: string;
  updated_at: string;
}

// --- Raw DB row types (what the server returns) ---

export interface RawTransaction {
  id: string;
  household_id: string;
  user_id: string | null;
  category_id: string | null;
  import_hash: string;
  encrypted_data: string | null;
  batch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawCategory {
  id: string;
  household_id: string;
  owner_user_id: string | null;
  sort_order: number;
  is_system: boolean;
  encrypted_data: string | null;
  created_at: string;
}

export interface RawUser {
  id: string;
  auth_id: string;
  household_id: string | null;
  email: string;
  encrypted_data: string | null;
  created_at: string;
}

export interface RawHousehold {
  id: string;
  invite_code: string | null;
  encrypted_dek: string | null;
  invite_code_salt: string | null;
  encrypted_data: string | null;
  created_at: string;
}

export interface RawMerchantRule {
  id: string;
  household_id: string;
  category_id: string | null;
  priority: number;
  is_learned: boolean;
  encrypted_data: string | null;
  created_at: string;
}

export interface RawSettlement {
  id: string;
  household_id: string;
  settlement_hash: string;
  is_settled: boolean;
  settled_at: string | null;
  encrypted_data: string | null;
  created_at: string;
}

// --- Parsed transaction (from file upload, before encryption) ---

export interface ParsedTransaction {
  description: string;
  date: string;
  amount: number;
  transaction_type?: string;
  category?: string;
  subcategory?: string;
  tags?: string[];
  notes?: string;
  bank_name?: string;
  account_number?: string;
  account_name?: string;
  import_hash?: string;
  isDuplicate?: boolean;
  autoCategory?: string | null;
}

// --- Multi-file upload types ---

export type FileFormat =
  | "zlantar_csv"
  | "zlantar_json"
  | "zlantar_data"
  | "bank_csv"
  | "unknown";

export interface AccountMetadata {
  account_index: number;
  bank_name: string;
  account_name: string;
  account_number?: string;
  account_type?: string;
  balance?: number;
}

export interface ZlantarUserProfile {
  name?: string;
  email?: string;
}

export interface FileParseResult {
  fileName: string;
  format: FileFormat;
  transactions: ParsedTransaction[];
  accounts: AccountMetadata[];
  userProfile?: ZlantarUserProfile;
  error?: string;
}
