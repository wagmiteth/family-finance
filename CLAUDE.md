# Family Finance

A shared household expense tracker built with Next.js and Supabase, featuring strict zero-knowledge encryption inspired by Proton Mail.

## Tech Stack
- **Frontend:** Next.js 15 (App Router), React, Tailwind CSS, shadcn/ui
- **Backend:** Supabase (Auth, PostgreSQL, RLS)
- **Encryption:** Web Crypto API (client-side AES-GCM 256-bit, zero-knowledge)
- **AI:** Anthropic Claude API for transaction enrichment

## Project Structure
- `app/` — Next.js pages and API routes
- `app/api/` — Server-side API routes (store/retrieve encrypted blobs only)
- `app/dashboard/` — Main app UI (all pages are `"use client"`)
- `lib/crypto/` — Client-side encryption (Web Crypto API)
- `lib/crypto/entity-crypto.ts` — Generic encrypt/decrypt for all entity types
- `lib/supabase/` — Supabase client helpers (server, client, admin, middleware)
- `lib/transactions/` — Transaction parsing, dedup, categorization
- `lib/settlements/` — Settlement calculation logic (client-side only)
- `components/ui/` — shadcn/ui components
- `supabase/migrations/` — Database migrations

## Security Architecture

**This app implements strict zero-knowledge end-to-end encryption inspired by [Proton Mail](https://proton.me/mail/security).**

The server (and database admin) can **only** see:
- Email addresses (Supabase Auth)
- UUIDs, timestamps, booleans, sort order integers (opaque metadata)
- Import hashes (SHA-256, irreversible)

The server **cannot** see:
- Transaction data (amounts, dates, descriptions, bank details, notes)
- Category names, split types, split ratios
- User names, household names
- Merchant rule patterns
- Settlement amounts and details
- Anthropic API keys

### Encryption Model
- Each household has a **Data Encryption Key (DEK)** — AES-GCM 256-bit
- Each user's DEK is wrapped with their **Key Encryption Key (KEK)** — derived from their password via PBKDF2 (600,000 iterations)
- **ALL** user data is encrypted client-side before leaving the browser
- Every table has an `encrypted_data TEXT` column containing the AES-GCM encrypted JSON blob
- The server stores only ciphertext — it is a pure storage layer

### What Gets Encrypted (per table)
| Table | Encrypted fields |
|-------|-----------------|
| transactions | description, amount, date, transaction_type, subcategory, tags, notes, bank_name, account_number, account_name, enriched_* |
| categories | name, display_name, description, split_type, split_ratio, color |
| households | name |
| users | name, avatar_url |
| merchant_rules | pattern, merchant_name, merchant_type, amount_hint, amount_max, notes, rule_type, match_transaction_type |
| settlements | month, from_user_id, to_user_id, amount, shared_total, notes, settled_amount, settled_from/to_user_id |
| user_settings | anthropic_api_key |

### Key Exchange
- When creating a household, the DEK is also wrapped with the invite code
- When a partner joins, they use the invite code to unwrap the DEK, then re-wrap it with their own password
- The invite-code-wrapped copy is deleted after joining

### Client-Side Processing
Since the server cannot read any data, all processing happens in the browser:
- **Filtering/sorting** transactions by date, amount, category
- **Settlement calculation** (who owes whom)
- **Auto-categorization** using merchant rules
- **API key decryption** for AI enrichment (sent transiently in request body)

### Important: Password = Encryption Key
If both household members forget their passwords, all financial data is **permanently lost**. There is no recovery mechanism. This is by design — identical to Proton Mail's security model.

## Key Files
- `lib/crypto/client-crypto.ts` — Core Web Crypto functions (PBKDF2, AES-GCM, AES-KW)
- `lib/crypto/entity-crypto.ts` — Generic encrypt/decrypt for all entity types
- `lib/crypto/encryption-context.tsx` — React context providing `useEncryption()` hook
- `lib/crypto/key-store.ts` — DEK session management (memory + sessionStorage)
- `lib/crypto/use-decrypted-fetch.ts` — Hook for fetching + decrypting any entity
- `lib/crypto/decrypt-transactions.ts` — Transaction-specific decryption
- `lib/settlements/calculator.ts` — Client-side settlement calculation

## Supabase CLI

Project is linked to ref `lwfnrbmjgwtudkjkfouw`.

### Common commands

- `supabase link --project-ref <ref>` — link to remote project
- `supabase db push` — push pending migrations to remote
- `supabase db pull` — pull remote schema changes
- `supabase db diff` — diff local vs remote schema
- `supabase db dump` — dump remote data/schema
- `supabase migration list` — show migration status
- `supabase migration repair <version> --status applied` — mark migration as applied

### Running arbitrary SQL on remote

The CLI has no `db execute` command. Use the Supabase Management API instead:

```bash
TOKEN=$(echo "<base64-token>" | base64 -d)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/lwfnrbmjgwtudkjkfouw/database/query" \
  -d '{"query": "SELECT 1"}'
```

### Deleting auth users

Use the Auth Admin API with the service role key:

```bash
# List users
curl -s -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users"

# Delete user
curl -s -X DELETE -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users/<user-id>"
```

### Migration naming

Supabase CLI expects timestamp-prefixed migration files for `db push`. This project uses a mix of sequential (001_) and timestamp-prefixed naming. Sequential migrations require manual repair via `supabase migration repair`.

### Cleaning up test data

When deleting users, respect FK order: `user_key_material` → `user_settings` → `categories` (null owner refs) → `users` → `households`. Use the service role key with the REST API.

## Development Notes
- All dashboard pages are client-rendered (`"use client"`)
- Data flows: Browser encrypts → `/api/` routes store blobs → Browser decrypts
- All filtering, sorting, and calculation happens client-side after decryption
- Transactions are scoped by `household_id` via RLS policies
- Settlement calculation happens in JS (`calculateSettlement()`) — never on the server
- Error messages in API routes are sanitized — never leak Supabase internals
- The `admin` client (service role) is only used for onboarding flows
- No server-side encryption keys exist — `_encryption_keys` table has been removed
