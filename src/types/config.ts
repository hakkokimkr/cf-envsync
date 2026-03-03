/** Root configuration (envsync.json) */
export interface EnvSyncConfig {
  /** Supported environments */
  environments: string[];

  /** .env file mapping rules */
  envFiles: {
    /** Pattern for env files, e.g. ".env.{env}". local falls back to ".env" */
    pattern: string;
    /** Per-developer override file (gitignored), only for local env */
    local: string;
    /** Allow per-app .env.{env} files */
    perApp: boolean;
  };

  /** Encryption method */
  encryption: "dotenvx" | "password" | "none";

  /** App definitions */
  apps: Record<string, AppConfig>;

  /** Shared secret keys (same value across multiple apps within an env) */
  shared?: string[];

  /** Per-developer local override configuration */
  local?: {
    /** Keys that each developer must set locally */
    overrides?: string[];
    /** Per-app developer override keys */
    perApp?: Record<string, string[]>;
  };
}

/** Configuration for a single app/worker */
export interface AppConfig {
  /** Path to app directory relative to project root */
  path: string;
  /** Cloudflare Worker names per environment (omit for non-worker apps) */
  workers?: Record<string, string>;
  /** Secret keys for this app (pushed via wrangler secret) */
  secrets?: string[];
  /** Var keys for this app (non-secret env vars) */
  vars?: string[];
  /** Output file(s) for `envsync dev`. Defaults to ".dev.vars".
   *  Use an array to generate multiple files, e.g. [".dev.vars", ".env.local"] */
  devFile?: string | string[];
}

/** Resolved config after defaults and path resolution */
export interface ResolvedConfig {
  /** Absolute path to project root */
  projectRoot: string;
  /** Original config */
  raw: EnvSyncConfig;
  /** Available environments */
  environments: string[];
  /** Resolved app configs */
  apps: Record<string, ResolvedAppConfig>;
}

export interface ResolvedAppConfig extends AppConfig {
  /** App name (key from config) */
  name: string;
  /** Absolute path to app directory */
  absolutePath: string;
  /** All keys this app needs (secrets + vars + local overrides) */
  allKeys: string[];
  /** Normalized output file names for `envsync dev` (always an array) */
  devFiles: string[];
}
