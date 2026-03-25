# Vercel Multi-Account CLI Setup

## Context
Deploy family-finance to a new Vercel account (oskar.carljohan.carlsson@gmail.com) separate from the legacy account (nsnodes@gmail.com for PNW/nsnodes), and set up CLI so both accounts can be controlled from the terminal — including from Claude Code sessions.

## Steps

### 1. Create new Vercel account
- Sign up at vercel.com with `oskar.carljohan.carlsson@gmail.com`
- Go to **Settings → Tokens** → create token named `cli-family-finance`

### 2. Create token for old account
- Log into vercel.com with `nsnodes@gmail.com`
- **Settings → Tokens** → create token named `cli-legacy`

### 3. Store tokens securely
```bash
mkdir -p ~/.vercel-tokens && chmod 700 ~/.vercel-tokens
echo "<new-token>" > ~/.vercel-tokens/new
echo "<old-token>" > ~/.vercel-tokens/old
chmod 600 ~/.vercel-tokens/*
```

### 4. Deploy family-finance
```bash
cd ~/development/family-finance
VERCEL_TOKEN=$(cat ~/.vercel-tokens/new) vercel link
VERCEL_TOKEN=$(cat ~/.vercel-tokens/new) vercel deploy
```
- Set env vars via `vercel env add` or dashboard (Supabase keys etc.)

### 5. Shell aliases (~/.zshrc)
```bash
alias vc-new='VERCEL_TOKEN=$(cat ~/.vercel-tokens/new) vercel'
alias vc-old='VERCEL_TOKEN=$(cat ~/.vercel-tokens/old) vercel'
```

### 6. Claude Code per-project access
Add npm scripts or document in CLAUDE.md so Claude Code can check deployments:
```bash
VERCEL_TOKEN=$VERCEL_TOKEN vercel ls
VERCEL_TOKEN=$VERCEL_TOKEN vercel inspect <url>
```

### 7. Verify
- `vc-new ls` — should show family-finance
- `vc-old ls` — should show PNW/nsnodes projects
