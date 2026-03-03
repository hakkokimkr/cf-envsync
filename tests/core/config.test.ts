import { describe, test, expect } from "bun:test";
import { validateConfig, resolveConfig, resolveApps, getWorkerName, resolveEnvFilePath } from "../../src/core/config.ts";
import type { EnvSyncConfig } from "../../src/types/config.ts";

const validConfig: EnvSyncConfig = {
  environments: ["local", "staging", "production"],
  envFiles: {
    pattern: ".env.{env}",
    local: ".env.local",
    perApp: true,
  },
  encryption: "dotenvx",
  apps: {
    api: {
      path: "apps/api",
      workers: { staging: "api-staging", production: "api-prod" },
      secrets: ["DATABASE_URL", "JWT_SECRET"],
      vars: ["API_URL"],
    },
    web: {
      path: "apps/web",
      workers: { staging: "web-staging", production: "web-prod" },
      secrets: ["AUTH_SECRET"],
      vars: ["VITE_API_URL"],
    },
  },
  shared: ["JWT_SECRET"],
  local: {
    overrides: ["DEV_TUNNEL_URL"],
    perApp: {
      api: ["OAUTH_REDIRECT_URL"],
    },
  },
};

describe("validateConfig", () => {
  test("returns no errors for valid config", () => {
    expect(validateConfig(validConfig)).toEqual([]);
  });

  test("reports missing environments", () => {
    const config = { ...validConfig, environments: [] };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("environments"))).toBe(true);
  });

  test("reports missing envFiles.pattern", () => {
    const config = {
      ...validConfig,
      envFiles: { ...validConfig.envFiles, pattern: "" },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("pattern"))).toBe(true);
  });

  test("allows apps without workers", () => {
    const config: EnvSyncConfig = {
      ...validConfig,
      apps: {
        database: { path: "packages/database", vars: ["DATABASE_URL"] },
      },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("workers"))).toBe(false);
  });

  test("reports no secrets or vars", () => {
    const config: EnvSyncConfig = {
      ...validConfig,
      apps: {
        api: { path: "apps/api", workers: { production: "w" } },
      },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("secrets"))).toBe(true);
  });

  test("reports no apps", () => {
    const config = { ...validConfig, apps: {} };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("No apps"))).toBe(true);
  });
});

describe("resolveConfig", () => {
  test("resolves app absolute paths", () => {
    const resolved = resolveConfig(validConfig);
    expect(resolved.apps.api!.absolutePath).toContain("apps/api");
    expect(resolved.apps.web!.absolutePath).toContain("apps/web");
  });

  test("computes allKeys including secrets + vars + local overrides", () => {
    const resolved = resolveConfig(validConfig);
    const apiKeys = resolved.apps.api!.allKeys;
    // secrets: DATABASE_URL, JWT_SECRET
    // vars: API_URL
    // local.perApp.api: OAUTH_REDIRECT_URL
    // local.overrides: DEV_TUNNEL_URL (if in allKeys for app — added globally)
    expect(apiKeys).toContain("DATABASE_URL");
    expect(apiKeys).toContain("JWT_SECRET");
    expect(apiKeys).toContain("API_URL");
    expect(apiKeys).toContain("OAUTH_REDIRECT_URL");
    expect(apiKeys).toContain("DEV_TUNNEL_URL");
  });

  test("preserves environments list", () => {
    const resolved = resolveConfig(validConfig);
    expect(resolved.environments).toEqual(["local", "staging", "production"]);
  });
});

describe("resolveApps", () => {
  const resolved = resolveConfig(validConfig);

  test("returns all apps when no filter", () => {
    const apps = resolveApps(resolved);
    expect(apps.length).toBe(2);
  });

  test("filters by name", () => {
    const apps = resolveApps(resolved, ["api"]);
    expect(apps.length).toBe(1);
    expect(apps[0]!.name).toBe("api");
  });

  test("exits with error for unknown app names", () => {
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code?: number) => { exitCode = code; throw new Error("process.exit"); }) as never;
    try {
      resolveApps(resolved, ["unknown"]);
    } catch {
      // expected
    }
    process.exit = originalExit;
    expect(exitCode).toBe(1);
  });
});

describe("getWorkerName", () => {
  const resolved = resolveConfig(validConfig);

  test("returns correct worker per environment", () => {
    const api = resolved.apps.api!;
    expect(getWorkerName(api, "staging")).toBe("api-staging");
    expect(getWorkerName(api, "production")).toBe("api-prod");
  });

  test("returns undefined for local", () => {
    const api = resolved.apps.api!;
    expect(getWorkerName(api, "local")).toBeUndefined();
  });
});

describe("resolveEnvFilePath", () => {
  test("local falls back to .env", () => {
    expect(resolveEnvFilePath(".env.{env}", "local")).toBe(".env");
  });

  test("staging uses pattern", () => {
    expect(resolveEnvFilePath(".env.{env}", "staging")).toBe(".env.staging");
  });

  test("production uses pattern", () => {
    expect(resolveEnvFilePath(".env.{env}", "production")).toBe(".env.production");
  });
});
