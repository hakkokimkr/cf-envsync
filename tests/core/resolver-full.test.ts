import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile as _writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolveAppEnv, findSharedValues } from "../../src/core/resolver.ts";
import { resolveConfig } from "../../src/core/config.ts";
import type { EnvSyncConfig, ResolvedConfig } from "../../src/types/config.ts";

let tmpDir: string;
let config: ResolvedConfig;

// Build a temp fixture directory
async function setupFixture() {
  tmpDir = await mkdtemp(join(tmpdir(), "envsync-resolver-full-"));

  // Create directory structure
  await mkdir(join(tmpDir, "apps", "api"), { recursive: true });

  // Root .env (local)
  await _writeFile(join(tmpDir, ".env"), "DB=root_local\nSHARED=root\nAPI_URL=http://localhost\n");

  // Root .env.staging
  await _writeFile(join(tmpDir, ".env.staging"), "DB=staging_db\nSHARED=staging\nAPI_URL=https://staging.example.com\n");

  // App .env (local)
  await _writeFile(join(tmpDir, "apps", "api", ".env"), "DB=app_local_db\n");

  // App .env.staging
  await _writeFile(join(tmpDir, "apps", "api", ".env.staging"), "DB=app_staging_db\n");

  // .env.local (per-dev overrides)
  await _writeFile(join(tmpDir, ".env.local"), "DEV_TUNNEL=https://my-tunnel.dev\n");

  // Config file (needed for findProjectRoot)
  const rawConfig: EnvSyncConfig = {
    environments: ["local", "staging", "production"],
    envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: true },
    encryption: "none",
    apps: {
      api: {
        path: "apps/api",
        workers: { staging: "api-stg", production: "api-prod" },
        secrets: ["DB"],
        vars: ["API_URL", "SHARED"],
      },
    },
    local: {
      overrides: ["DEV_TUNNEL"],
    },
  };

  // Write config file so findProjectRoot can locate the project root
  await _writeFile(join(tmpDir, "envsync.json"), JSON.stringify(rawConfig, null, 2));

  config = resolveConfig(rawConfig, tmpDir);
}

await setupFixture();

afterAll(async () => {
  await rm(tmpDir, { recursive: true });
});

describe("resolveAppEnv", () => {
  test("3-layer merge for local env (root + app + .env.local)", async () => {
    const app = config.apps.api!;
    const resolved = await resolveAppEnv(config, app, "local");

    // app .env overrides root .env for DB
    expect(resolved.map.DB).toBe("app_local_db");
    // root provides SHARED and API_URL
    expect(resolved.map.SHARED).toBe("root");
    expect(resolved.map.API_URL).toBe("http://localhost");
    // .env.local provides DEV_TUNNEL
    expect(resolved.map.DEV_TUNNEL).toBe("https://my-tunnel.dev");
    // layers should include 3 sources
    expect(resolved.layers.length).toBe(3);
  });

  test("2-layer merge for non-local env (root + app, no .env.local)", async () => {
    const app = config.apps.api!;
    const resolved = await resolveAppEnv(config, app, "staging");

    // app staging overrides root staging for DB
    expect(resolved.map.DB).toBe("app_staging_db");
    // root staging provides SHARED and API_URL
    expect(resolved.map.SHARED).toBe("staging");
    expect(resolved.map.API_URL).toBe("https://staging.example.com");
    // no .env.local layer for staging
    expect(resolved.map.DEV_TUNNEL).toBeUndefined();
  });

  test("filters to app keys only", async () => {
    const app = config.apps.api!;
    const resolved = await resolveAppEnv(config, app, "local");

    // Only keys declared in allKeys should be present
    for (const key of Object.keys(resolved.map)) {
      expect(app.allKeys).toContain(key);
    }
  });
});

describe("resolveAppEnv with perApp=false", () => {
  test("skips app layer when perApp is false", async () => {
    const noPerAppConfig: EnvSyncConfig = {
      environments: ["local", "staging"],
      envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: false },
      encryption: "none",
      apps: {
        api: {
          path: "apps/api",
          workers: { staging: "api-stg" },
          secrets: ["DB"],
          vars: ["SHARED"],
        },
      },
    };

    // Overwrite config file temporarily for findProjectRoot
    await _writeFile(join(tmpDir, "envsync.json"), JSON.stringify(noPerAppConfig, null, 2));
    const cfg = resolveConfig(noPerAppConfig, tmpDir);
    const app = cfg.apps.api!;
    const resolved = await resolveAppEnv(cfg, app, "local");

    // With perApp=false, only root .env is used, not app .env
    // Root has DB=root_local
    expect(resolved.map.DB).toBe("root_local");
  });
});

describe("findSharedValues", () => {
  test("finds common keys across apps", () => {
    const appEnvs = new Map<string, Record<string, string>>([
      ["api", { JWT: "secret", DB: "pg://a" }],
      ["web", { JWT: "secret", AUTH: "x" }],
    ]);

    const shared = findSharedValues(appEnvs);
    expect(shared).toEqual([{ key: "JWT", value: "secret" }]);
  });

  test("single app returns all keys as shared", () => {
    const appEnvs = new Map<string, Record<string, string>>([
      ["api", { A: "1", B: "2" }],
    ]);

    const shared = findSharedValues(appEnvs);
    expect(shared.length).toBe(2);
    expect(shared).toContainEqual({ key: "A", value: "1" });
    expect(shared).toContainEqual({ key: "B", value: "2" });
  });

  test("empty input returns empty", () => {
    const shared = findSharedValues(new Map());
    expect(shared).toEqual([]);
  });
});
