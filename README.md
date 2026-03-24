# Family Finance

A shared household expense tracker with end-to-end encryption. Built for couples who want to split expenses fairly without exposing their financial data to anyone — including the app developer.

## Features

- **Upload transactions** from CSV/JSON bank exports
- **Categorize** with drag-and-drop (shared, private, work, exclude)
- **AI enrichment** — identify merchants and enrich transaction descriptions using Claude
- **Monthly settlements** — automatically calculate who owes whom
- **Auto-categorization** — learn from your sorting patterns via merchant rules
- **End-to-end encryption** — your financial data is encrypted before it leaves your browser

## Security

### Zero-Knowledge Architecture

Inspired by [Proton Mail](https://proton.me/mail), Family Finance implements client-side encryption where the server never sees your data in plaintext.

```text
Your Password
    |
    v  PBKDF2 (600,000 iterations, SHA-256)
Key Encryption Key (KEK)
    |
    v  AES-KW (unwrap)
Data Encryption Key (DEK) — one per household
    |
    v  AES-GCM-256 (encrypt/decrypt)
Your transaction descriptions, bank details, notes
```

**What the server can see:**

- Transaction dates and amounts (needed for settlement calculations)
- Category assignments (needed for expense splitting)
- Which user made each transaction

**What the server cannot see:**

- Transaction descriptions (merchant names)
- Bank names and account numbers
- Notes and AI enrichment data
- Your Anthropic API key (encrypted separately)

### Key Exchange

When you create a household and invite your partner:

1. A random **Data Encryption Key (DEK)** is generated in your browser
2. The DEK is wrapped (encrypted) with a key derived from your password
3. A copy is also wrapped with the invite code (shared secret)
4. When your partner joins, they use the invite code to unwrap the DEK and re-wrap it with their own password
5. The invite-code copy is deleted — only password-wrapped copies remain

### Password = Encryption Key

> **Important:** If both household members forget their passwords, all financial data is permanently lost. There is no recovery mechanism. This is a deliberate security trade-off — the same one [Proton Mail](https://proton.me/mail) makes.

### Row Level Security

All database tables use Supabase Row Level Security (RLS) policies to enforce household-level data isolation at the database level. Error messages are sanitized to never leak database internals.

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React, TypeScript, Tailwind CSS
- **UI Components:** shadcn/ui
- **Database:** Supabase (PostgreSQL with RLS)
- **Auth:** Supabase Auth (email/password)
- **Encryption:** Web Crypto API (AES-GCM, AES-KW, PBKDF2)
- **AI:** Anthropic Claude API (user-provided key, encrypted at rest)
- **Drag & Drop:** dnd-kit
- **Charts:** Recharts

## Getting Started

### Prerequisites

- Node.js 20+
- Supabase CLI (`brew install supabase`)

### Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase URL and keys

# Run database migrations
supabase db push

# Start development server
npm run dev
```

### Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## How It Works

1. **Sign up** — your password becomes your encryption key (a warning is shown)
2. **Create a household** — generates encryption keys, gives you an invite code
3. **Invite your partner** — they join with the code, completing the key exchange
4. **Upload bank exports** — transactions are encrypted in your browser before upload
5. **Categorize together** — drag transactions between columns (shared, private, etc.)
6. **Settle up** — the app calculates the monthly balance and who pays whom
