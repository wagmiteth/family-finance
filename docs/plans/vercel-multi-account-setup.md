# Vercel Multi-Account CLI Setup

## Context
Deploy family-finance to a new Vercel account (oskar.carljohan.carlsson@gmail.com) separate from the legacy account (nsnodes@gmail.com for PNW/wagmit), and set up CLI so both accounts can be controlled from the terminal — including from Claude Code sessions.

## Steps

### 1. Create new Vercel account
- Sign up at vercel.com with `oskar.carljohan.carlsson@gmail.com`
- Go to **Settings → Tokens** → create token named `cli-oskar-carlsson`
- Token stored in `~/.vercel-tokens/oskar-carlsson`

### 2. Create token for old account
- Log into vercel.com with `nsnodes@gmail.com`
- **Settings → Tokens** → create token named `wagmit-cli-access`
- Token stored in `~/.vercel-tokens/wagmit`

### 3. Store tokens securely
<!-- Creates a private folder in your home dir and saves each token to a file.
     chmod 700 = only you can access the folder. chmod 600 = only you can read the files.
     Keeps tokens out of any git repo and inaccessible to other users on the machine. -->
```bash
mkdir -p ~/.vercel-tokens && chmod 700 ~/.vercel-tokens
echo "<oskar-carlsson-token>" > ~/.vercel-tokens/oskar-carlsson
echo "<wagmit-token>" > ~/.vercel-tokens/wagmit
chmod 600 ~/.vercel-tokens/*
```

### 4. Deploy family-finance
<!-- "vercel link" connects this project folder to a Vercel project on the new account (creates .vercel/ locally).
     "vercel deploy" pushes a preview deployment.
     The VERCEL_TOKEN=... prefix authenticates as the new account without needing to be "logged in". -->
```bash
cd ~/development/family-finance
VERCEL_TOKEN=$(cat ~/.vercel-tokens/oskar-carlsson) vercel link
VERCEL_TOKEN=$(cat ~/.vercel-tokens/oskar-carlsson) vercel deploy
```
- Set env vars via `vercel env add` or dashboard (Supabase keys etc.)

### 5. Shell aliases (~/.zshrc)
<!-- Shortcuts so you can type "vc-ff ls" or "vc-wg ls" instead of the full VERCEL_TOKEN=... command.
     Each alias reads its token from file and passes it inline — no login/logout needed.
     The token decides which account you're talking to. -->
```bash
alias vc-ff='VERCEL_TOKEN=$(cat ~/.vercel-tokens/oskar-carlsson) vercel'
alias vc-wg='VERCEL_TOKEN=$(cat ~/.vercel-tokens/wagmit) vercel'
```

### 6. Claude Code per-project access
<!-- Lets Claude Code check deployment status, inspect errors, etc. from within a session
     without you needing to switch accounts or log in. -->
Add npm scripts or document in CLAUDE.md so Claude Code can check deployments:
```bash
VERCEL_TOKEN=$VERCEL_TOKEN vercel ls
VERCEL_TOKEN=$VERCEL_TOKEN vercel inspect <url>
```

### 7. Verify
<!-- Quick sanity check that both aliases work and each shows the correct projects. -->
- `vc-ff ls` — should show family-finance
- `vc-wg ls` — should show PNW/wagmit projects
