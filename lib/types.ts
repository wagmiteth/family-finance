export interface Household {
  id: string;
  name: string;
  invite_code: string | null;
  created_at: string;
}

export interface User {
  id: string;
  auth_id: string;
  household_id: string | null;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Category {
  id: string;
  household_id: string;
  name: string;
  display_name: string;
  description: string | null;
  split_type: "equal" | "full_payer" | "none";
  split_ratio: number;
  owner_user_id: string | null;
  color: string | null;
  sort_order: number;
  is_system: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  household_id: string;
  user_id: string | null;
  category_id: string | null;
  description: string;
  amount: number;
  date: string;
  transaction_type: string | null;
  subcategory: string | null;
  tags: string[] | null;
  notes: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  enriched_name: string | null;
  enriched_info: string | null;
  enriched_description: string | null;
  enriched_address: string | null;
  enriched_at: string | null;
  import_hash: string;
  created_at: string;
  updated_at: string;
}

export interface MerchantRule {
  id: string;
  household_id: string;
  pattern: string;
  category_id: string | null;
  merchant_name: string | null;
  merchant_type: string | null;
  amount_hint: number | null;
  amount_max: number | null;
  priority: number;
  is_learned: boolean;
  notes: string | null;
  created_at: string;
}

export interface Settlement {
  id: string;
  household_id: string;
  month: string;
  from_user_id: string | null;
  to_user_id: string | null;
  amount: number;
  shared_total: number | null;
  is_settled: boolean;
  settled_at: string | null;
  settled_amount: number | null;
  settled_from_user_id: string | null;
  settled_to_user_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface UserSettings {
  user_id: string;
  has_api_key: boolean;
  masked_api_key: string | null;
  theme: string;
  updated_at: string;
}

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
  account_type?: string; // e.g. "Transactional", "Credit", "Savings"
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
