# Why We Built envsync

## The Short Version

We're a two-person team building on Cloudflare Workers. We spent more time fighting our environment variable setup than writing actual code. Every existing tool solved *part* of the problem but nothing handled the full picture: encrypted secrets, multiple Workers in a monorepo, per-developer local values, and staging/production deployments — all without breaking Git.

---

## The Problems

### 1. dotenvx Encrypts Your .env — Then Breaks Git

dotenvx is great. Encrypt your `.env`, commit it safely, share secrets through Git. Problem solved, right?

Not quite. dotenvx uses ephemeral keys (ECIES), which means **the same plaintext produces different ciphertext every time you encrypt**. So when two developers both run `dotenvx encrypt`, every single line changes — even the ones nobody touched.

```
<<<<<<< HEAD
API_KEY="encrypted:BGVh3xyz..."
=======
API_KEY="encrypted:BKrt5abc..."
>>>>>>> feature-branch
```

This isn't a real conflict. The decrypted value is identical on both sides. But Git doesn't know that. You can't diff it. You can't auto-merge it. You just pick a side and hope.

Using `dotenvx set` for individual keys helps, but the moment two people modify different keys in the same file at the same time — conflict.

**We needed: a merge driver that understands dotenvx encryption. Decrypt → merge by key → re-encrypt.**

---

### 2. Three Layers of Environment Variables That Don't Talk to Each Other

If you're building a Vite + Cloudflare Workers app, you're dealing with three completely separate systems:

| Layer | File | Access | Scope |
|-------|------|--------|-------|
| Vite (client) | `.env` | `import.meta.env.VITE_*` | Build-time, browser |
| Wrangler (local dev) | `.dev.vars` | `env.XXX` | Runtime, local only |
| CF Workers (deployed) | Dashboard / `wrangler secret` | `env.XXX` | Runtime, remote |

Same key, three places to define it. Forget to update one? Silent failure in production.

Your `VITE_API_URL` lives in `.env` for Vite. Your `DATABASE_URL` lives in `.dev.vars` for wrangler. Your production `DATABASE_URL` lives in Cloudflare's dashboard. None of them sync.

**We needed: one source of truth that distributes to each layer automatically.**

---

### 3. Per-Developer Values That Can't Be Shared

Not every secret is the same across developers. OAuth redirect URLs depend on each developer's tunnel:

```bash
# Developer A
OAUTH_REDIRECT_URL=https://alice-dev.example.com/callback

# Developer B
OAUTH_REDIRECT_URL=https://bob-dev.example.com/callback
```

So you can't just commit this value. And you can't leave it out of the shared `.env` either, because then nobody knows the key exists.

Most teams end up with one of these:
- A Notion doc that says "don't forget to set OAUTH_REDIRECT_URL" (nobody reads it)
- A `.env.example` that's always outdated
- Slack messages saying "hey what's the new env var again?"

**We needed: explicit declaration of which keys are per-developer, with validation that they're actually set.**

---

### 4. Monorepo = N Workers × M Environments × Pain

A typical Cloudflare Workers monorepo might look like:

```
apps/
├── api/           → my-app-api (staging + production)
├── web/           → my-app-web (staging + production)
└── collector/     → my-app-collector (staging + production)
```

That's 3 apps × 2 deployed environments = **6 Workers**, each with their own secrets.

Some secrets are shared (`JWT_SECRET` across api + web). Some are app-specific (`YOUTUBE_API_KEY` only in collector). Some differ by environment (`DATABASE_URL` is different in staging vs production).

How do you manage this today?

```bash
# Repeat for each worker × each environment
wrangler secret put DATABASE_URL --env staging --name my-app-api
wrangler secret put DATABASE_URL --env production --name my-app-api
wrangler secret put DATABASE_URL --env staging --name my-app-web
# ... you get the idea
```

Shared secrets are worse. Change `JWT_SECRET` and you need to update it in every worker that uses it — manually, one at a time, hoping you don't miss one.

**We needed: declare once which app uses which keys, push to all matching workers in one command.**

---

### 5. Cloudflare Secrets Store Works in Production, Breaks Locally

Cloudflare's new Secrets Store (account-level secrets) is a step forward. But it introduces an API mismatch:

```typescript
// Production — Secrets Store binding
const dbUrl = await env.DATABASE_URL.get();

// Local dev — .dev.vars injects a plain string
const dbUrl = await env.DATABASE_URL.get();
// TypeError: env.DATABASE_URL.get is not a function
```

You end up writing wrappers everywhere:

```typescript
const dbUrl = typeof env.DATABASE_URL === "string"
  ? env.DATABASE_URL
  : await env.DATABASE_URL.get();
```

This is in every file, for every secret. The [GitHub issue](https://github.com/cloudflare/workers-sdk/issues/9534) has been open with no resolution.

**We needed: local dev that just works without polluting application code with type checks.**

---

### 6. wrangler.jsonc Is Static — No Variable Interpolation

Unlike Docker Compose or Terraform, `wrangler.jsonc` doesn't support `${ENV_VAR}` syntax:

```jsonc
// docker-compose.yml — this works
// environment:
//   DATABASE_URL: ${DATABASE_URL}

// wrangler.jsonc — this does NOT work
{
  "vars": {
    "DATABASE_URL": "${DATABASE_URL}"  // ← nope, literal string
  }
}
```

So you either hardcode values per environment in the config file, or manage them entirely out-of-band through `wrangler secret` commands. There's no middle ground.

**We needed: a way to populate wrangler config from .env files without manual duplication.**

---

### 7. No Way to Verify What's Actually Deployed

"Is production using the new API key or the old one?"

There's no simple way to diff your local `.env.production` against what's actually set as secrets on your Cloudflare Workers. The dashboard shows secret names but hides values. `wrangler secret list` only shows names, not values.

You deploy and pray. If something breaks, you re-push all secrets just to be safe.

**We needed: a diff between local env files and remote worker secrets, with clear indication of what changed.**

---

## What Exists Today (And Why It's Not Enough)

| Tool | What It Does | What It Doesn't Do |
|------|-------------|-------------------|
| **dotenvx** | Encrypts .env, safe to commit | Git merge conflicts, no CF Workers sync |
| **Infisical / Doppler** | Centralized secrets, CF Workers sync | SaaS dependency, overkill for small teams, per-Worker only |
| **wrangler secret** | Sets CF Workers secrets | One key at a time, no bulk diff, no .env integration |
| **CF Secrets Store** | Account-level secrets | Broken local dev, no .env sync |
| **.dev.vars** | Local dev secrets | Doesn't sync with anything, separate from .env |
| **dotenv-vault** | Hosted .env sync | Deprecated in favor of dotenvx, no CF integration |

Every tool solves one piece. Nothing connects them.

---

## What envsync Does

**One `.env` file → everywhere it needs to go.**

```bash
envsync dev                    # .env + .env.local → .dev.vars for each app
envsync push staging           # .env.staging → CF Workers secrets (all apps)  
envsync push production api    # .env.production → just the api worker
envsync diff production        # local vs what's actually deployed
envsync validate               # catch missing keys before they break prod
```

The core idea:

```
.env.{environment}  ──→  envsync  ──→  Cloudflare Workers secrets
       +                    │              (per worker, per env)
.env.local          ──→    │
(per-developer)            ├──→  .dev.vars for each app
                           │              (local dev)
                           └──→  validation
                                      (nothing missing)
```

**No SaaS.** No hosted dashboard. Just a CLI that reads your `.env` files and talks to Cloudflare's API. Your secrets stay in your repo (encrypted) and your CI/CD pipeline.

**Monorepo-native.** Declare which app uses which keys. Shared secrets are defined once, pushed everywhere.

**Git-friendly.** Custom merge driver decrypts dotenvx files, merges by key name, re-encrypts. No more fake conflicts.

---

## Who This Is For

- Teams building on **Cloudflare Workers** with encrypted `.env` files
- **Monorepos** with multiple Workers sharing secrets
- Anyone tired of `wrangler secret put` one key at a time
- Small teams (2-10 people) who don't want Doppler/Infisical overhead
- Projects using **Vite + Workers** that fight the env variable layer mismatch

---

## Status

Early stage, built to solve our own pain. If any of the above made you nod, we'd love contributors.

```bash
npm install -g envsync    # soon
```