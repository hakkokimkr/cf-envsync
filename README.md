<p align="center">
  <br />
  <code>.env</code>&nbsp;&nbsp;→&nbsp;&nbsp;<strong>Cloudflare Workers</strong>&nbsp;&nbsp;→&nbsp;&nbsp;done.
  <br />
  <br />
</p>

<h1 align="center">envsync</h1>

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
bun add -d envsync
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
- [dotenvx](https://dotenvx.com) (optional, for encryption)

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
- Scans `wrangler.jsonc` files to discover workers and environments
- Detects shared secrets across apps
- Creates `envsync.config.ts`, `.env.example`, and empty `.env.{environment}` files
- Adds `.env.local`, `.env.keys`, `**/.dev.vars` to `.gitignore`
- Registers the custom Git merge driver in `.gitattributes`

---

### `envsync normalize` — Sort keys

Alphabetically sorts keys in all `.env*` files. Reduces diff noise, prevents merge conflicts.

```bash
envsync normalize              # All .env* files recursively
envsync normalize .env.staging # Specific file
```

---

### `envsync merge` — Git merge driver

A 3-way merge driver that understands dotenvx encryption. Registered automatically by `envsync init`.

```
# .gitattributes (auto-generated)
.env merge=envsync
.env.* merge=envsync
```

How it works:

1. Decrypts all three versions (base, ours, theirs)
2. 3-way merge at the **key level** — not the encrypted ciphertext
3. Only real conflicts get conflict markers
4. Re-encrypts the merged result

No more fake conflicts from identical values with different ciphertext.

---

## Configuration

### `envsync.config.ts`

The recommended way to configure envsync. Full type checking, autocomplete, and comments.

```ts
import { defineConfig } from "envsync";

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
/** @type {import("envsync").EnvSyncConfig} */
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
| `encryption` | `"dotenvx" \| "none"` | Encryption method for `.env` files |
| `apps.{name}.path` | `string` | Path to app directory relative to project root |
| `apps.{name}.workers` | `Record<string, string>` | Worker name per environment |
| `apps.{name}.secrets` | `string[]` | Secret keys pushed via `wrangler secret bulk` |
| `apps.{name}.vars` | `string[]` | Non-secret env vars (not pushed as secrets) |
| `shared` | `string[]` | Keys with the same value across multiple apps |
| `local.overrides` | `string[]` | Keys each developer must set in `.env.local` |
| `local.perApp` | `Record<string, string[]>` | Per-app developer override keys |

</details>

Config file search order: `envsync.config.ts` > `.js` > `.mjs` > `envsync.json` > `envsync.jsonc`

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
└── .gitignore                      # .env.local, .env.keys, **/.dev.vars
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
import { defineConfig } from "envsync";

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

**envsync** fills the gap: encrypted `.env` files as the single source of truth, synced to every target — Workers secrets, `.dev.vars`, validation — with monorepo and multi-environment support built in.

No SaaS. No dashboard. Just a CLI, your `.env` files, and Cloudflare's API.

---

## Tech Stack

| | |
|---|---|
| **Runtime** | [Node.js](https://nodejs.org) >= 18 or [Bun](https://bun.sh) |
| **CLI framework** | [citty](https://github.com/unjs/citty) |
| **Output** | [consola](https://github.com/unjs/consola) |
| **Config loading** | [jiti](https://github.com/unjs/jiti) |
| **Encryption** | [@dotenvx/dotenvx](https://dotenvx.com) |
| **CF Secrets** | [wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI (shell out) |

---

## License

MIT
