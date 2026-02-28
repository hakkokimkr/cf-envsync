import { describe, test, expect } from "bun:test";
import { findMissingOverrides } from "../../src/core/resolver.ts";
import { resolveConfig } from "../../src/core/config.ts";
import type { EnvSyncConfig } from "../../src/types/config.ts";

const config: EnvSyncConfig = {
  environments: ["local", "staging", "production"],
  envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: true },
  encryption: "dotenvx",
  apps: {
    api: {
      path: "apps/api",
      workers: { staging: "api-stg", production: "api" },
      secrets: ["DATABASE_URL"],
      vars: ["API_URL"],
    },
  },
  shared: [],
  local: {
    overrides: ["DEV_TUNNEL_URL"],
    perApp: { api: ["OAUTH_REDIRECT_URL"] },
  },
};

describe("findMissingOverrides", () => {
  const resolved = resolveConfig(config);
  const api = resolved.apps.api!;

  test("detects missing global and per-app overrides", () => {
    const missing = findMissingOverrides(resolved, api, {});
    expect(missing).toContain("DEV_TUNNEL_URL");
    expect(missing).toContain("OAUTH_REDIRECT_URL");
  });

  test("no missing when all present", () => {
    const missing = findMissingOverrides(resolved, api, {
      DEV_TUNNEL_URL: "https://tunnel",
      OAUTH_REDIRECT_URL: "https://callback",
    });
    expect(missing).toEqual([]);
  });

  test("detects partial missing", () => {
    const missing = findMissingOverrides(resolved, api, {
      DEV_TUNNEL_URL: "https://tunnel",
    });
    expect(missing).toEqual(["OAUTH_REDIRECT_URL"]);
  });
});
