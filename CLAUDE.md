# cf-envsync

CLI tool that syncs `.env` files to Cloudflare Workers secrets, `.dev.vars`, and validates nothing is missing.

## Project structure

```
src/
├── index.ts              # CLI entry (citty runMain, lazy subCommands)
├── define-config.ts      # Public API: defineConfig() + type exports
├── commands/             # 9 commands: dev, push, pull, validate, diff, init, normalize, merge, list
├── core/                 # config.ts, env-file.ts, encryption.ts, resolver.ts, wrangler.ts
├── types/                # config.ts (EnvSyncConfig, AppConfig), env.ts (EnvMap, DiffEntry, etc.)
└── utils/                # fs.ts, process.ts, output.ts
tests/
├── core/                 # Unit tests for config, env-file, resolver
└── fixtures/             # Sample project with envsync.json + .env files
```

## Development

- **Runtime**: Bun for dev/test, builds to Node.js-compatible bundle
- **Build**: `bun run build` → `dist/index.js` (bundles all except jiti)
- **Test**: `bun test` (26 tests across 3 files)
- **Dev**: `bun run src/index.ts <command>`

## Key conventions

- Use `node:fs`, `node:path`, `node:child_process` — no Bun-specific APIs in src/
- Config loading uses `jiti` for cross-runtime .ts/.js support (externalized from bundle)
- Config search order: `envsync.config.ts` > `.js` > `.mjs` > `envsync.json` > `.jsonc`
- CLI framework: citty (unjs). Output: consola (unjs). Both from the unjs ecosystem.
- Wrangler interaction is via shell-out (`src/utils/process.ts`), not SDK

## Publishing

- **npm**: `cf-envsync` (public, unscoped)
- **GitHub**: https://github.com/hakkokimkr/cf-envsync
- Build before publish: `prepublishOnly` script runs `bun run build`
- Published files: `dist/`, `src/define-config.ts`, `src/types/`
