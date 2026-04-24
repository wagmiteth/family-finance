import Papa from "papaparse";
import type {
  ParsedTransaction,
  FileParseResult,
  FileFormat,
  AccountMetadata,
  ZlantarUserProfile,
} from "@/lib/types";

// --- Zlantar CSV Swedish→English header map ---
const ZLANTAR_CSV_HEADERS: Record<string, string> = {
  index: "index",
  beskrivning: "description",
  datum: "date",
  belopp: "amount",
  transaktionstyp: "transaction_type",
  huvudkategori: "category",
  kategori: "subcategory",
  taggar: "tags",
  anteckning: "notes",
  bank: "bank_name",
  kontonummer: "account_number",
  kontonamn: "account_name",
  kontoindex: "account_index",
  // English fallbacks (already normalized)
  description: "description",
  date: "date",
  amount: "amount",
  transaction_type: "transaction_type",
  category: "category",
  subcategory: "subcategory",
  tags: "tags",
  notes: "notes",
  bank_name: "bank_name",
  account_number: "account_number",
  account_name: "account_name",
  account_index: "account_index",
};

// Known Zlantar CSV columns for format detection
const ZLANTAR_REQUIRED_COLUMNS = ["beskrivning", "datum", "belopp"];
const ZLANTAR_REQUIRED_COLUMNS_EN = ["description", "date", "amount"];

// Users can mark required columns with a trailing `*` in the CSV header
// (e.g. `description*`) for readability. Strip it before matching.
function stripRequiredMarker(header: string): string {
  return header.replace(/\*+$/, "").trim();
}

// --- Format Detection ---

function detectFileFormat(content: string, fileName: string): FileFormat {
  const trimmed = content.trim();

  // JSON detection
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);

      // Array of objects → Zlantar transaction JSON
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0];
        if (
          ("description" in first || "index" in first) &&
          ("date" in first || "amount" in first)
        ) {
          return "zlantar_json";
        }
      }

      // Object with user/banks keys → Zlantar data.json
      if (!Array.isArray(parsed) && ("user" in parsed || "banks" in parsed)) {
        return "zlantar_data";
      }

      // Array but doesn't match zlantar transaction shape
      if (Array.isArray(parsed)) {
        return "unknown";
      }
    } catch {
      // Not valid JSON, fall through
    }
  }

  // CSV detection
  if (fileName.endsWith(".csv") || !trimmed.startsWith("{")) {
    const firstLine = trimmed.split("\n")[0].toLowerCase();
    const delimiter = firstLine.includes(";") ? ";" : ",";
    const headers = firstLine
      .split(delimiter)
      .map((h) => stripRequiredMarker(h));

    // Zlantar CSV: has Swedish column names
    const hasZlantarSv = ZLANTAR_REQUIRED_COLUMNS.every((col) =>
      headers.includes(col)
    );
    const hasZlantarEn = ZLANTAR_REQUIRED_COLUMNS_EN.every((col) =>
      headers.includes(col)
    );

    if (hasZlantarSv || hasZlantarEn) {
      return "zlantar_csv";
    }

    // Raw bank CSV: has rows with data but unknown headers
    if (headers.length >= 2) {
      return "bank_csv";
    }
  }

  return "unknown";
}

// --- Zlantar CSV Parser ---

function parseZlantarCSV(content: string): ParsedTransaction[] {
  const delimiter = content.includes(";") ? ";" : ",";

  const result = Papa.parse(content, {
    header: true,
    delimiter,
    skipEmptyLines: true,
    transformHeader: (header: string) => {
      const cleaned = stripRequiredMarker(header).toLowerCase();
      return ZLANTAR_CSV_HEADERS[cleaned] || cleaned;
    },
  });

  return (result.data as Record<string, string>[])
    .filter((row) => row.description && row.date && row.amount)
    .map((row) => ({
      description: String(row.description || "").trim(),
      date: parseDate(row.date),
      amount: parseAmount(row.amount),
      transaction_type: row.transaction_type || undefined,
      category: row.category || undefined,
      subcategory: row.subcategory || undefined,
      tags: row.tags
        ? String(row.tags)
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
      notes: row.notes || undefined,
      bank_name: row.bank_name || undefined,
      account_number: row.account_number || undefined,
      account_name: row.account_name || undefined,
    }));
}

// --- Zlantar Transaction JSON Parser ---

function parseZlantarJSON(content: string): ParsedTransaction[] {
  const data = JSON.parse(content);
  const items: Record<string, unknown>[] = Array.isArray(data) ? data : [data];

  return items.map((item) => ({
    description: String(
      item.description || item.beskrivning || ""
    ).trim(),
    date: parseDate(
      String(item.date || item.datum || "")
    ),
    amount: parseAmount(item.amount ?? item.belopp),
    transaction_type:
      (item.transaction_type as string) ||
      (item.transaktionstyp as string) ||
      undefined,
    category:
      (item.category as string) ||
      (item.huvudkategori as string) ||
      undefined,
    subcategory:
      (item.subcategory as string) || (item.kategori as string) || undefined,
    tags: Array.isArray(item.tags)
      ? (item.tags as string[])
      : typeof item.tags === "string"
        ? item.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : typeof item.taggar === "string"
          ? (item.taggar as string)
              .split(",")
              .map((t: string) => t.trim())
              .filter(Boolean)
          : undefined,
    notes:
      (item.notes as string) || (item.anteckning as string) || undefined,
    bank_name:
      (item.bank_name as string) || (item.bank as string) || undefined,
    account_number:
      (item.account_number as string) ||
      (item.kontonummer as string) ||
      undefined,
    account_name:
      (item.account_name as string) ||
      (item.kontonamn as string) ||
      undefined,
  }));
}

// --- Zlantar data.json Parser (account metadata only) ---

interface ZlantarDataJson {
  user?: { name?: string; email?: string };
  banks?: {
    name: string;
    accounts?: {
      name?: string;
      number?: string;
      balance?: number;
      type?: string;
      account_index?: number;
    }[];
  }[];
}

function parseZlantarData(content: string): {
  accounts: AccountMetadata[];
  userProfile?: ZlantarUserProfile;
} {
  const data: ZlantarDataJson = JSON.parse(content);
  const accounts: AccountMetadata[] = [];

  if (data.banks) {
    for (const bank of data.banks) {
      if (bank.accounts) {
        for (const acc of bank.accounts) {
          accounts.push({
            account_index: acc.account_index ?? 0,
            bank_name: bank.name,
            account_name: acc.name || "",
            account_number: acc.number,
            account_type: acc.type,
            balance: acc.balance,
          });
        }
      }
    }
  }

  return {
    accounts,
    userProfile: data.user
      ? { name: data.user.name, email: data.user.email }
      : undefined,
  };
}

// --- Raw Bank CSV Parser ---

// Common Swedish bank CSV column name patterns
const BANK_CSV_COLUMN_MAP: Record<string, string> = {
  // Date columns
  datum: "date",
  bokföringsdatum: "date",
  transaktionsdatum: "date",
  bokföringsdag: "date",
  date: "date",
  // Description columns
  text: "description",
  beskrivning: "description",
  mottagare: "description",
  meddelande: "description",
  transaktion: "description",
  typ: "description",
  description: "description",
  // Amount columns
  belopp: "amount",
  summa: "amount",
  "belopp (sek)": "amount",
  amount: "amount",
  // Balance columns
  saldo: "balance",
  balance: "balance",
  // Reference
  referens: "reference",
  reference: "reference",
};

function parseBankCSV(content: string): ParsedTransaction[] {
  const delimiter = content.includes(";") ? ";" : ",";

  const result = Papa.parse(content, {
    header: true,
    delimiter,
    skipEmptyLines: true,
    transformHeader: (header: string) => {
      const cleaned = stripRequiredMarker(header.replace(/"/g, "")).toLowerCase();
      return BANK_CSV_COLUMN_MAP[cleaned] || cleaned;
    },
  });

  const rows = result.data as Record<string, string>[];

  // Find the best column for each required field by checking what's populated
  const fields = result.meta.fields?.map((f) => f.toLowerCase()) || [];
  const hasDate = fields.includes("date");
  const hasDescription = fields.includes("description");
  const hasAmount = fields.includes("amount");

  if (!hasDate || !hasAmount) {
    // Can't parse without at least date and amount
    return [];
  }

  return rows
    .filter((row) => row.date && row.amount)
    .map((row) => ({
      description: hasDescription
        ? String(row.description || "").trim()
        : "",
      date: parseDate(row.date),
      amount: parseAmount(row.amount),
    }));
}

// --- Helpers ---

function parseDate(value: unknown): string {
  if (!value) return "";
  const str = String(value).trim();
  try {
    const d = new Date(str);
    if (!isNaN(d.valueOf())) {
      return d.toISOString().split("T")[0];
    }
  } catch {
    // fall through
  }
  // Try Swedish date format DD/MM/YYYY or YYYY-MM-DD (already handled above)
  return str;
}

function parseAmount(value: unknown): number {
  if (typeof value === "number") return value;
  if (!value) return 0;
  // Handle Swedish number format: "1 234,56" → 1234.56
  const str = String(value)
    .replace(/\s/g, "")
    .replace(",", ".");
  return Number(str) || 0;
}

// --- Validation ---

function isValidTransaction(t: ParsedTransaction): boolean {
  return (
    !!t.description?.trim() &&
    !!t.date &&
    !isNaN(new Date(t.date).valueOf()) &&
    Number.isFinite(t.amount)
  );
}

/**
 * Validate parsed transactions and return detailed error messages.
 * Returns an array of human-readable issues.
 */
function validateTransactions(
  transactions: ParsedTransaction[],
  rawRowCount: number
): string[] {
  const errors: string[] = [];

  if (rawRowCount === 0) {
    errors.push("File contains no data rows");
    return errors;
  }

  let missingDescription = 0;
  let missingDate = 0;
  let invalidDate = 0;
  let missingAmount = 0;
  let invalidAmount = 0;

  for (const t of transactions) {
    if (!t.description?.trim()) missingDescription++;
    if (!t.date) missingDate++;
    else if (isNaN(new Date(t.date).valueOf())) invalidDate++;
    if (t.amount === 0 && !Number.isFinite(t.amount)) missingAmount++;
    else if (!Number.isFinite(t.amount)) invalidAmount++;
  }

  if (missingDescription > 0)
    errors.push(`${missingDescription} row(s) missing required "description" field`);
  if (missingDate > 0)
    errors.push(`${missingDate} row(s) missing required "date" field`);
  if (invalidDate > 0)
    errors.push(`${invalidDate} row(s) have invalid date format (expected YYYY-MM-DD)`);
  if (missingAmount > 0)
    errors.push(`${missingAmount} row(s) missing required "amount" field`);
  if (invalidAmount > 0)
    errors.push(`${invalidAmount} row(s) have invalid amount (must be a number)`);

  return errors;
}

// --- Public API ---

/**
 * Parse a single file and return structured result with format detection.
 */
export function parseFile(content: string, fileName: string): FileParseResult {
  const format = detectFileFormat(content, fileName);

  switch (format) {
    case "zlantar_csv": {
      const all = parseZlantarCSV(content);
      const valid = all.filter(isValidTransaction);
      const warnings = validateTransactions(all, all.length);
      return {
        fileName,
        format,
        transactions: valid,
        accounts: [],
        ...(warnings.length > 0 && {
          error: `${valid.length} valid, ${all.length - valid.length} skipped: ${warnings.join("; ")}`,
        }),
      };
    }

    case "zlantar_json": {
      const all = parseZlantarJSON(content);
      const valid = all.filter(isValidTransaction);
      const warnings = validateTransactions(all, all.length);
      return {
        fileName,
        format,
        transactions: valid,
        accounts: [],
        ...(warnings.length > 0 && {
          error: `${valid.length} valid, ${all.length - valid.length} skipped: ${warnings.join("; ")}`,
        }),
      };
    }

    case "zlantar_data": {
      const { accounts, userProfile } = parseZlantarData(content);
      return {
        fileName,
        format,
        transactions: [],
        accounts,
        userProfile,
      };
    }

    case "bank_csv": {
      const all = parseBankCSV(content);
      const valid = all.filter(isValidTransaction);
      const warnings = validateTransactions(all, all.length);
      return {
        fileName,
        format,
        transactions: valid,
        accounts: [],
        ...(warnings.length > 0 && {
          error: `${valid.length} valid, ${all.length - valid.length} skipped: ${warnings.join("; ")}`,
        }),
      };
    }

    default: {
      // Try to detect if it's a CSV/JSON with wrong columns
      const trimmed = content.trim();
      let hint = "Could not detect file format.";

      if (fileName.endsWith(".csv")) {
        const firstLine = trimmed.split("\n")[0].toLowerCase();
        const delimiter = firstLine.includes(";") ? ";" : ",";
        const headers = firstLine.split(delimiter).map((h) => h.trim().replace(/"/g, ""));
        const missing = ["description", "date", "amount"].filter(
          (col) => !headers.includes(col) && !headers.includes(ZLANTAR_CSV_HEADERS[col] || col)
        );
        if (missing.length > 0) {
          hint = `CSV is missing required column(s): ${missing.join(", ")}. Found columns: ${headers.join(", ")}`;
        }
      } else if (fileName.endsWith(".json")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const keys = Object.keys(parsed[0]);
            const missing = ["description", "date", "amount"].filter(
              (col) => !keys.includes(col)
            );
            if (missing.length > 0) {
              hint = `JSON objects are missing required field(s): ${missing.join(", ")}. Found fields: ${keys.join(", ")}`;
            }
          } else if (!Array.isArray(parsed)) {
            hint = "JSON must be an array of transaction objects, e.g. [{ description, date, amount }]";
          }
        } catch {
          hint = "Invalid JSON — check for syntax errors";
        }
      }

      return {
        fileName,
        format: "unknown",
        transactions: [],
        accounts: [],
        error: hint,
      };
    }
  }
}

/**
 * Parse multiple files and merge results.
 * If both data.json and transaction files are uploaded, account metadata
 * is merged into the transaction results.
 */
export function parseFiles(
  files: { content: string; fileName: string }[]
): FileParseResult[] {
  const results = files.map((f) => parseFile(f.content, f.fileName));

  // Collect account metadata from all data.json files
  const allAccounts: AccountMetadata[] = [];
  let userProfile: ZlantarUserProfile | undefined;
  for (const r of results) {
    if (r.format === "zlantar_data") {
      allAccounts.push(...r.accounts);
      if (r.userProfile) userProfile = r.userProfile;
    }
  }

  // If we have account metadata, enrich transaction results with bank info
  if (allAccounts.length > 0) {
    const accountByIndex = new Map(
      allAccounts.map((a) => [a.account_index, a])
    );

    for (const r of results) {
      if (r.format !== "zlantar_data") {
        // Attach collected accounts so the UI can display them
        r.accounts = allAccounts;
        if (userProfile) r.userProfile = userProfile;
      }
    }

    // Enrich transactions that have account_index info but no bank_name
    // (This bridges data.json account metadata into transaction records)
    for (const r of results) {
      for (const tx of r.transactions) {
        if (!tx.bank_name && tx.account_name) {
          // Try to find matching account by name
          const match = allAccounts.find(
            (a) => a.account_name === tx.account_name
          );
          if (match) {
            tx.bank_name = tx.bank_name || match.bank_name;
            tx.account_number = tx.account_number || match.account_number;
          }
        }
      }
    }
  }

  return results;
}

/**
 * Legacy API — parse a single file's content, returning just transactions.
 * Kept for backward compatibility with existing code.
 */
export function parseTransactions(content: string): ParsedTransaction[] {
  const result = parseFile(content, "upload");
  return result.transactions;
}
