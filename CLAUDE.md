# Family Finance

A shared household expense tracker built with Next.js and Supabase.

## Tech Stack
- **Frontend:** Next.js 15 (App Router), React, Tailwind CSS, shadcn/ui
- **Backend:** Supabase (Auth, PostgreSQL, RLS)
- **Encryption:** Web Crypto API (client-side), pgcrypto (server-side legacy)
- **AI:** Anthropic Claude API for transaction enrichment

## Project Structure
- `app/` — Next.js pages and API routes
- `app/api/` — Server-side API routes (all data flows through these)
- `app/dashboard/` — Main app UI (all pages are `"use client"`)
- `lib/crypto/` — Client-side encryption (Web Crypto API)
- `lib/supabase/` — Supabase client helpers (server, client, admin, middleware)
- `lib/transactions/` — Transaction parsing, dedup, categorization, encryption helpers
- `lib/settlements/` — Settlement calculation logic
- `components/ui/` — shadcn/ui components
- `supabase/migrations/` — Database migrations (001-006)

## Security Architecture

**This app implements end-to-end encryption inspired by Proton Mail's zero-knowledge model.**

### Encryption Model
- Each household has a **Data Encryption Key (DEK)** — AES-GCM 256-bit
- Each user's DEK is wrapped with their **Key Encryption Key (KEK)** — derived from their password via PBKDF2 (600,000 iterations)
- Sensitive transaction fields (description, bank details, notes, enrichment data) are encrypted client-side before leaving the browser
- The server stores only ciphertext — it cannot read user data
- Non-sensitive fields (date, amount, category_id) remain in plaintext for SQL queries

### Key Exchange
- When creating a household, the DEK is also wrapped with the invite code
- When a partner joins, they use the invite code to unwrap the DEK, then re-wrap it with their own password
- The invite-code-wrapped copy is deleted after joining

### Dual-Mode (Migration)
- `encryption_version = 0`: Legacy server-side encryption (pgcrypto)
- `encryption_version = 1`: Client-side encryption (Web Crypto AES-GCM)
- The API routes and dashboard pages handle both transparently

### Important: Password = Encryption Key
If both household members forget their passwords, all financial data is **permanently lost**. There is no recovery mechanism. This is by design.

## Key Files
- `lib/crypto/client-crypto.ts` — Core Web Crypto functions (PBKDF2, AES-GCM, AES-KW)
- `lib/crypto/encryption-context.tsx` — React context providing `useEncryption()` hook
- `lib/crypto/key-store.ts` — DEK session management (memory + sessionStorage)
- `lib/crypto/use-decrypted-fetch.ts` — Hook for fetching + decrypting transactions
- `supabase/migrations/004_security_hardening.sql` — RLS policies, API key encryption
- `supabase/migrations/005_encrypt_transactions.sql` — Server-side transaction encryption
- `supabase/migrations/006_client_side_encryption.sql` — Client-side encryption schema

## Supabase CLI

Project is linked to ref `lwfnrbmjgwtudkjkfouw`. CLI version 2.78.1.

### Common commands

- `supabase link --project-ref <ref>` — link to remote project
- `supabase db push` — push pending migrations to remote
- `supabase db pull` — pull remote schema changes
- `supabase db diff` — diff local vs remote schema
- `supabase db dump` — dump remote data/schema
- `supabase migration list` — show migration status
- `supabase migration repair <version> --status applied` — mark migration as applied

### Running arbitrary SQL on remote

The CLI (v2.78) has no `db execute` command. Use the Supabase Management API instead:

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

### Auth config (rate limits etc)

Use the Management API:

```bash
# Read config
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.supabase.com/v1/projects/lwfnrbmjgwtudkjkfouw/config/auth"

# Update config (e.g. auto-confirm)
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/lwfnrbmjgwtudkjkfouw/config/auth" \
  -d '{"mailer_autoconfirm": true}'
```

### Migration naming

Supabase CLI expects timestamp-prefixed migration files for `db push`. This project uses sequential numbering (001_, 002_, etc.) which requires manual repair or using the Management API to run SQL directly.

### Cleaning up test data

When deleting users, respect FK order: `user_key_material` → `user_settings` → `categories` (null owner refs) → `users` → `households`. Use the service role key with the REST API.

## Development Notes
- All dashboard pages are client-rendered (`"use client"`)
- Data flows: Browser → `/api/` routes → Supabase
- Transactions are filtered by `household_id` via RLS policies
- Settlement calculation happens in JS (not SQL), using `calculateSettlement()`
- Error messages in API routes are sanitized — never leak Supabase internals
- The `admin` client (service role) is only used for onboarding flows
