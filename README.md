<p align="center">
  <br />
  <code>.env</code>&nbsp;&nbsp;→&nbsp;&nbsp;<strong>Cloudflare Workers</strong>&nbsp;&nbsp;→&nbsp;&nbsp;done.
  <br />
  <br />
</p>

<h1 align="center">envsync</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/cf-envsync"><img src="https://img.shields.io/npm/v/cf-envsync.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/cf-envsync"><img src="https://img.shields.io/npm/dm/cf-envsync.svg" alt="npm downloads" /></a>
  <a href="https://github.com/hakkokimkr/cf-envsync/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/cf-envsync.svg" alt="license" /></a>
  <a href="https://github.com/hakkokimkr/cf-envsync"><img src="https://img.shields.io/github/stars/hakkokimkr/cf-envsync.svg?style=social" alt="GitHub stars" /></a>
</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/node/v/cf-envsync.svg" alt="node version" /></a>
  <a href="https://github.com/hakkokimkr/cf-envsync"><img src="https://img.shields.io/github/last-commit/hakkokimkr/cf-envsync.svg" alt="last commit" /></a>
  <a href="https://github.com/hakkokimkr/cf-envsync/issues"><img src="https://img.shields.io/github/issues/hakkokimkr/cf-envsync.svg" alt="issues" /></a>
  <img src="https://img.shields.io/badge/TypeScript-100%25-blue.svg" alt="TypeScript" />
</p>

<p align="center">
  One <code>.env</code> file. Every Worker. Every environment.<br />
  No SaaS. No dashboard. Just your repo.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="#commands">Commands</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="#configuration">Config</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="#why">Why?</a>
</p>

---

```
.env.{environment}  ──→  envsync  ──→  Cloudflare Workers secrets
       +                    │              (per worker, per env)
.env.local          ──→    │
(per-developer)            ├──→  .dev.vars for each app
                           │              (local dev)
                           └──→  validation
                                      (nothing missing)
```

---

## The Problem

If you're building on **Cloudflare Workers** with **dotenvx** encryption in a **monorepo**, you know the pain:

- **dotenvx breaks Git** — Same plaintext, different ciphertext every time. Two devs touch `.env` = guaranteed merge conflict.
- **Three layers that don't sync** — Vite reads `.env`, wrangler reads `.dev.vars`, production reads from the dashboard. Forget to update one? Silent failure.
- **N Workers x M Environments x manual labor** — `wrangler secret put` one key at a time, per worker, per environment.
- **Per-developer secrets** — OAuth callback URLs differ per dev tunnel. No way to enforce they're set.
- **No way to verify what's deployed** — "Is production using the new key or the old one?" Push and pray.

Every existing tool solves one piece. **envsync connects them all.**

---

## Quick Start

```bash
# bun
bun add -d cf-envsync

# npm
npm install -D cf-envsync

# pnpm
pnpm add -D cf-envsync
```

```bash
# Initialize (scans wrangler.jsonc files in monorepos)
envsync init --monorepo

# Generate .dev.vars for local development
envsync dev

# Push secrets to staging
envsync push staging

# Validate nothing is missing before deploying
envsync validate
```

### Requirements

- [Node.js](https://nodejs.org) >= 18 or [Bun](https://bun.sh)
- [wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI (peer dependency, for push/pull/diff)
- [dotenvx](https://dotenvx.com) (optional, only if using `encryption: "dotenvx"`)

---

## 5-Minute Tutorial

A complete walkthrough: project setup → local dev → deploy to staging → validate.

### 1. Initialize your project

```bash
# In your monorepo root
npm install -D cf-envsync
envsync init --monorepo
```

This scans for `wrangler.jsonc` files, discovers your workers, and generates:

```
envsync.config.ts   ← config with all apps/workers detected
.env.example        ← key reference (committed to git)
.env                ← local shared secrets
.env.staging        ← staging secrets (empty, you'll fill these)
.env.production     ← production secrets (empty)
.gitignore          ← updated with .env.local, .env.password, **/.dev.vars
```

### 2. Fill in your secrets

```bash
# .env — local development values (committed, encrypted)
DATABASE_URL=postgres://localhost:5432/mydb
JWT_SECRET=dev_jwt_secret
AUTH_SECRET=dev_auth_secret
API_URL=http://localhost:8787

# .env.staging — staging values
DATABASE_URL=postgres://staging-db.example.com/mydb
JWT_SECRET=staging_jwt_secret_abc
AUTH_SECRET=staging_auth_secret_xyz
API_URL=https://api-staging.example.com

# .env.local — YOUR dev-specific overrides (gitignored, each dev has their own)
OAUTH_REDIRECT_URL=https://my-tunnel.ngrok.io/callback
DEV_TUNNEL_URL=https://my-tunnel.ngrok.io
```

### 3. Encrypt before committing (optional)

```bash
# Set a password
echo "ENVSYNC_PASSWORD=my-team-password" > .env.password

# Encrypt all plain values
envsync encrypt staging
envsync encrypt production

# Now .env.staging looks like:
# DATABASE_URL=envsync:v1:base64payload...
# JWT_SECRET=envsync:v1:base64payload...
```

### 4. Local development

```bash
envsync dev
```

This reads `.env` + `.env.local`, merges them, and writes `.dev.vars` into each app directory. Start wrangler as usual — it reads `.dev.vars` automatically.

```
apps/api/.dev.vars      ← DATABASE_URL, JWT_SECRET, API_URL, OAUTH_REDIRECT_URL
apps/web/.dev.vars      ← AUTH_SECRET, VITE_API_URL, VITE_OAUTH_REDIRECT_URL
```

> **Vite / non-wrangler apps:** `.dev.vars` is for wrangler only. If your app runs with `vite dev`, set `devFile` in your config:
>
> ```ts
> apps: {
>   web: {
>     path: "apps/web",
>     devFile: ".env.local",          // Vite reads this
>     // or generate both:
>     // devFile: [".dev.vars", ".env.local"],
>   },
> }
> ```

If you forgot to set a per-dev override, envsync tells you:

```
⚠ Missing in .env.local: DEV_TUNNEL_URL (required per-dev override)
  → echo "DEV_TUNNEL_URL=https://your-tunnel.example.com" >> .env.local
```

### 5. Push to staging

```bash
# Preview first
envsync push staging --dry-run

# Push for real
envsync push staging
#   Push 4 secrets to worker "my-api-staging" (staging)? yes
#   ✓ Pushed 4 secrets to my-api-staging
#   Push 1 secrets to worker "my-web-staging" (staging)? yes
#   ✓ Pushed 1 secrets to my-web-staging
```

### 6. Validate before deploying

```bash
envsync validate
# Checks every app × every environment against .env.example
# Exit code 1 if anything is missing → safe for CI
```

### 7. CI/CD integration

```yaml
# GitHub Actions example
- name: Validate env vars
  run: envsync validate

- name: Push secrets to production
  run: envsync push production --force
  env:
    ENVSYNC_PASSWORD: ${{ secrets.ENVSYNC_PASSWORD }}
    CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

---

## Commands

### `envsync dev` — Generate `.dev.vars`

The command you'll use most. Merges `.env` + `.env.local` and writes `.dev.vars` for each app.

```bash
envsync dev                    # All apps
envsync dev api                # Just api
envsync dev api web            # Multiple apps
envsync dev --env staging      # Use staging values for local dev
```

```
$ envsync dev

  apps/api/.dev.vars
  ├ DATABASE_URL             ← .env
  ├ TWITCH_CLIENT_SECRET     ← .env (shared)
  ├ TWITCH_CLIENT_ID         ← .env (shared)
  ├ JWT_SECRET               ← .env (shared)
  ├ API_URL                  ← .env
  └ OAUTH_REDIRECT_URL       ← .env.local (per-dev override)

  apps/web/.dev.vars
  ├ AUTH_SECRET              ← .env
  ├ VITE_API_URL             ← .env
  └ VITE_OAUTH_REDIRECT_URL  ← .env.local (per-dev override)

⚠ Missing in .env.local: DEV_TUNNEL_URL (required per-dev override)
  → echo "DEV_TUNNEL_URL=https://your-tunnel.example.com" >> .env.local

Done!
```

Every key shows exactly where its value came from. Missing per-dev overrides are caught immediately.

> **Vite / non-wrangler apps:** Set `devFile: ".env.local"` in your app config. See [the tutorial](#4-local-development).

---

### `envsync push` — Deploy secrets

Push secrets to Cloudflare Workers via `wrangler secret bulk`. One command, all workers.

```bash
envsync push staging                # All apps → staging workers
envsync push production             # All apps → production workers
envsync push staging api            # Just api's staging worker
envsync push production --shared    # Only shared secrets (JWT_SECRET, etc.)
```

```
$ envsync push staging --dry-run

  Pushing secrets for api → my-app-api-staging (staging)...
    Would push 4 secrets to worker "my-app-api-staging"
      DATABASE_URL
      TWITCH_CLIENT_ID (shared)
      TWITCH_CLIENT_SECRET (shared)
      JWT_SECRET (shared)

  Pushing secrets for web → my-app-web-staging (staging)...
    Would push 1 secrets to worker "my-app-web-staging"
      AUTH_SECRET

Done!
```

Use `--dry-run` to preview. Use `--force` to skip confirmation prompts (CI-friendly).

---

### `envsync diff` — Compare environments

Two modes: **local vs remote** and **env vs env**.

```bash
# Local .env.production vs what's actually on Cloudflare
envsync diff production
envsync diff production api

# Compare two environments side-by-side
envsync diff staging production
```

```
$ envsync diff staging production

  stream-collector
    TWITCH_CLIENT_ID         stag****             prod****             ✔ expected
    TWITCH_CLIENT_SECRET     stag****             prod****             ✔ expected
    YOUTUBE_API_KEY          stag****             (missing)            ✘ missing in production!

    1 key(s) missing
```

Catch missing keys before they break production.

---

### `envsync validate` — Catch missing keys

Checks all apps across all environments against `.env.example`.

```bash
envsync validate               # All environments, all apps
envsync validate staging       # Just staging
envsync validate staging api   # Just api in staging
```

```
$ envsync validate

Checking against .env.example...

  local
  ✔ api: all 8 keys present
  ✔ web: all 6 keys present
  ✔ stream-collector: all 6 keys present

  staging
  ✔ api: all 6 keys present
  ✔ web: all 3 keys present
  ✔ stream-collector: all 4 keys present

  production
  ✔ api: all 6 keys present
  ✔ web: all 3 keys present
  ✘ stream-collector: 3/4 keys
    missing: YOUTUBE_API_KEY

⚠ 1 environment(s) have issues
```

Exits with code 1 on failure — plug it into CI.

---

### `envsync pull` — Scaffold from remote

Pull secret key names from Cloudflare and scaffold empty entries in your local `.env` file. (Values are not available via the API — only key names.)

```bash
envsync pull staging
envsync pull production api
```

---

### `envsync list` — See the full picture

```bash
envsync list               # Summary table
envsync list api --keys    # Detailed key list for one app
```

```
$ envsync list

  App               local              staging                      production
  ────────────────  ─────────────────  ───────────────────────────  ───────────────────
  api               (dev)              my-app-api-staging           my-app-api
                    4 secrets, 2 vars  4 secrets, 2 vars            4 secrets, 2 vars

  web               (dev)              my-app-web-staging           my-app-web
                    1 secret, 2 vars   1 secret, 2 vars             1 secret, 2 vars

  stream-collector  (dev)              my-app-collector-staging     my-app-collector
                    4 secrets          4 secrets                    3 secrets

  Shared secrets (3): JWT_SECRET, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
  Per-dev overrides (local only): OAUTH_REDIRECT_URL, DEV_TUNNEL_URL, VITE_OAUTH_REDIRECT_URL

  .env files status:
  ├ .env ✔ (11 keys)
  ├ .env.staging ✔ (11 keys)
  ├ .env.production ✔ (10 keys)
  └ .env.local ✔ (3 overrides)
```

---

### `envsync init` — Project setup

Interactive setup that scans your repo and generates everything.

```bash
envsync init               # Single project
envsync init --monorepo    # Scans for wrangler.jsonc files
```

What it does:
- Asks for encryption method (`password`, `dotenvx`, or `none`)
- Scans `wrangler.jsonc` files to discover workers and environments
- Detects shared secrets across apps
- Creates `envsync.config.ts`, `.env.example`, and empty `.env.{environment}` files
- Adds `.env.local`, `.env.keys`, `.env.password`, `**/.dev.vars` to `.gitignore`
- Registers the custom Git merge driver in `.gitattributes`

---

### `envsync normalize` — Sort keys

Alphabetically sorts keys in all `.env*` files. Reduces diff noise, prevents merge conflicts.

```bash
envsync normalize              # All .env* files recursively
envsync normalize .env.staging # Specific file
```

---

### `envsync encrypt` — Encrypt plain values

Encrypts plain-text values in a `.env` file using password-based encryption (AES-256-GCM). Only available when `encryption: "password"`.

```bash
envsync encrypt staging           # Encrypt all plain values in .env.staging
envsync encrypt production        # Encrypt .env.production
envsync encrypt staging --dry-run # Preview without writing
```

```
$ envsync encrypt staging

  DATABASE_URL: encrypted
  API_KEY: encrypted
  JWT_SECRET: encrypted

Encrypted 3 values in .env.staging (0 skipped)
```

Already-encrypted and empty values are skipped automatically.

---

### `envsync merge` — Git merge driver

A 3-way merge driver that understands both dotenvx and password encryption. Registered automatically by `envsync init`.

```
# .gitattributes (auto-generated)
.env merge=envsync
.env.* merge=envsync
```

How it works:

1. Decrypts all three versions (base, ours, theirs) — supports both dotenvx and password encryption
2. 3-way merge at the **key level** — not the encrypted ciphertext
3. Only real conflicts get conflict markers
4. Re-encrypts the merged result (password mode uses `encryptEnvMap`, dotenvx uses `dotenvx encrypt`)

No more fake conflicts from identical values with different ciphertext.

---

## Configuration

### `envsync.config.ts`

The recommended way to configure envsync. Full type checking, autocomplete, and comments.

```ts
import { defineConfig } from "cf-envsync";

export default defineConfig({
  environments: ["local", "staging", "production"],

  envFiles: {
    pattern: ".env.{env}",  // local → .env, staging → .env.staging
    local: ".env.local",    // per-developer overrides (gitignored)
    perApp: true,           // allow apps/api/.env.staging etc.
  },

  encryption: "dotenvx",

  apps: {
    api: {
      path: "apps/api",
      workers: {
        staging: "my-api-staging",
        production: "my-api",
      },
      secrets: ["DATABASE_URL", "JWT_SECRET"],
      vars: ["API_URL", "ENVIRONMENT"],
    },
    web: {
      path: "apps/web",
      workers: {
        staging: "my-web-staging",
        production: "my-web",
      },
      secrets: ["AUTH_SECRET"],
      vars: ["VITE_API_URL", "VITE_APP_URL"],
    },
  },

  shared: ["JWT_SECRET"],

  local: {
    overrides: ["DEV_TUNNEL_URL"],
    perApp: {
      api: ["OAUTH_REDIRECT_URL"],
      web: ["VITE_OAUTH_REDIRECT_URL"],
    },
  },
});
```

<details>
<summary><strong>Also works with plain JSON</strong></summary>

`envsync.json` and `envsync.jsonc` are also supported:

```jsonc
{
  "environments": ["local", "staging", "production"],
  "envFiles": {
    "pattern": ".env.{env}",
    "local": ".env.local",
    "perApp": true
  },
  "encryption": "dotenvx",
  "apps": {
    "api": {
      "path": "apps/api",
      "workers": { "staging": "my-api-staging", "production": "my-api" },
      "secrets": ["DATABASE_URL", "JWT_SECRET"],
      "vars": ["API_URL", "ENVIRONMENT"]
    }
  }
}
```

</details>

<details>
<summary><strong>JSDoc (for .js configs)</strong></summary>

If you prefer plain JavaScript, use JSDoc for type checking:

```js
// envsync.config.js
/** @type {import("cf-envsync").EnvSyncConfig} */
export default {
  environments: ["local", "staging", "production"],
  // ...
};
```

</details>

<details>
<summary><strong>Config reference</strong></summary>

| Field | Type | Description |
|-------|------|-------------|
| `environments` | `string[]` | Available environments |
| `envFiles.pattern` | `string` | File naming pattern. `{env}` is replaced. `local` falls back to `.env` |
| `envFiles.local` | `string` | Per-developer override file (gitignored) |
| `envFiles.perApp` | `boolean` | Allow per-app `.env.{env}` files for app-specific overrides |
| `encryption` | `"password" \| "dotenvx" \| "none"` | Encryption method for `.env` files |
| `apps.{name}.path` | `string` | Path to app directory relative to project root |
| `apps.{name}.workers` | `Record<string, string>` | Worker name per environment |
| `apps.{name}.secrets` | `string[]` | Secret keys pushed via `wrangler secret bulk` |
| `apps.{name}.vars` | `string[]` | Non-secret env vars (not pushed as secrets) |
| `apps.{name}.devFile` | `string \| string[]` | Output file(s) for `envsync dev`. Default: `".dev.vars"`. Use `".env.local"` for Vite apps, or an array for both |
| `shared` | `string[]` | Keys with the same value across multiple apps |
| `local.overrides` | `string[]` | Keys each developer must set in `.env.local` |
| `local.perApp` | `Record<string, string[]>` | Per-app developer override keys |

</details>

Config file search order: `envsync.config.ts` > `.js` > `.mjs` > `envsync.json` > `envsync.jsonc`

### Encryption

envsync supports three encryption modes:

| Mode | How it works | Dependencies |
|------|-------------|--------------|
| `"password"` | AES-256-GCM, per-value encryption with a shared password. Values stored as `envsync:v1:{base64}`. | None (uses `node:crypto`) |
| `"dotenvx"` | ECIES public/private key encryption via dotenvx CLI. | `dotenvx` CLI |
| `"none"` | No encryption. `.env` files stored in plain text. | None |

#### Password encryption

Per-value encryption means each key-value pair is encrypted independently — git diffs are readable at the key level, and merges work cleanly.

```
# .env.staging (committed, encrypted)
DATABASE_URL=envsync:v1:base64encodedpayload...
API_KEY=envsync:v1:base64encodedpayload...
```

**Password source** (checked in order):

1. `ENVSYNC_PASSWORD_{ENV}` env var (e.g. `ENVSYNC_PASSWORD_STAGING`)
2. `ENVSYNC_PASSWORD` env var (generic fallback)
3. `.env.password` file with `ENVSYNC_PASSWORD_{ENV}=xxx` (env-specific)
4. `.env.password` file with `ENVSYNC_PASSWORD=xxx` (generic fallback)

```bash
# Quick setup
echo "ENVSYNC_PASSWORD=your-strong-password" > .env.password

# Or per-environment passwords
cat > .env.password << 'EOF'
ENVSYNC_PASSWORD_STAGING=staging-password
ENVSYNC_PASSWORD_PRODUCTION=production-password
EOF

# Encrypt plain values
envsync encrypt staging
envsync encrypt production
```

### File structure

```
project/
├── envsync.config.ts                  # Config (committed)
│
├── .env                            # Local shared secrets (encrypted, committed)
├── .env.staging                    # Staging secrets (encrypted, committed)
├── .env.production                 # Production secrets (encrypted, committed)
├── .env.local                      # Per-developer overrides (gitignored)
├── .env.example                    # Key reference (committed)
├── .env.keys                       # dotenvx private keys (gitignored)
├── .env.password                   # Password encryption keys (gitignored)
│
├── apps/
│   ├── api/
│   │   ├── wrangler.jsonc
│   │   ├── .dev.vars               # ← generated by envsync dev
│   │   └── .env.staging            # [optional] api-specific staging overrides
│   ├── web/
│   │   ├── wrangler.jsonc
│   │   └── .dev.vars               # ← generated
│   └── stream-collector/
│       ├── wrangler.jsonc
│       ├── .dev.vars               # ← generated
│       └── .env                    # app-specific secrets (YOUTUBE_API_KEY, etc.)
│
└── .gitignore                      # .env.local, .env.keys, .env.password, **/.dev.vars
```

### Merge priority

Values are merged in this order (last wins):

```
root .env.{env}  →  app .env.{env}  →  .env.local (local env only)
```

---

## Single project

Works the same way. Just one app with `path: "."`:

```ts
import { defineConfig } from "cf-envsync";

export default defineConfig({
  environments: ["local", "staging", "production"],
  envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: false },
  encryption: "dotenvx",
  apps: {
    default: {
      path: ".",
      workers: { staging: "my-worker-staging", production: "my-worker" },
      secrets: ["DATABASE_URL", "API_KEY"],
    },
  },
});
```

---

## Why?

<table>
<tr><th>Tool</th><th>What it does</th><th>What it doesn't</th></tr>
<tr><td><strong>dotenvx</strong></td><td>Encrypts .env, safe to commit</td><td>Git merge conflicts, no CF Workers sync</td></tr>
<tr><td><strong>Infisical / Doppler</strong></td><td>Centralized secrets, CF Workers sync</td><td>SaaS dependency, overkill for small teams</td></tr>
<tr><td><strong>wrangler secret</strong></td><td>Sets CF Workers secrets</td><td>One key at a time, no bulk diff, no .env integration</td></tr>
<tr><td><strong>CF Secrets Store</strong></td><td>Account-level secrets</td><td>Broken local dev, no .env sync</td></tr>
<tr><td><strong>.dev.vars</strong></td><td>Local dev secrets</td><td>Doesn't sync with anything</td></tr>
</table>

**envsync** fills the gap: encrypted `.env` files as the single source of truth, synced to every target — Workers secrets, `.dev.vars`, validation — with monorepo and multi-environment support built in. Choose password encryption (zero dependencies, per-value, merge-friendly) or dotenvx (ECIES key pairs).

No SaaS. No dashboard. Just a CLI, your `.env` files, and Cloudflare's API.

---

## Testing

150 tests across 20 files covering utils, core modules, and all 10 commands.

```bash
bun test              # Run tests
bun test --coverage   # Run with coverage report
```

### Coverage

| File | % Funcs | % Lines |
|------|---------|---------|
| **All files** | **83.93** | **76.13** |
| src/core/resolver.ts | 100.00 | 100.00 |
| src/core/wrangler.ts | 100.00 | 100.00 |
| src/core/env-file.ts | 100.00 | 98.65 |
| src/core/encryption.ts | 100.00 | 95.65 |
| src/utils/fs.ts | 100.00 | 97.44 |
| src/core/config.ts | 71.43 | 76.23 |
| src/commands/merge.ts | 75.00 | 28.40 |
| src/utils/output.ts | 25.00 | 12.70 |

> `merge.ts` and `output.ts` line coverage is lower because their command handlers and print functions are tested via CLI integration tests (spawned subprocesses), which bun's coverage instrumentation does not trace into.

---

## Tech Stack

| | |
|---|---|
| **Runtime** | [Node.js](https://nodejs.org) >= 18 or [Bun](https://bun.sh) |
| **CLI framework** | [citty](https://github.com/unjs/citty) |
| **Output** | [consola](https://github.com/unjs/consola) |
| **Config loading** | [jiti](https://github.com/unjs/jiti) |
| **Encryption** | `node:crypto` AES-256-GCM (password mode) / [@dotenvx/dotenvx](https://dotenvx.com) (dotenvx mode) |
| **CF Secrets** | [wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI (shell out) |

---

## License

MIT
