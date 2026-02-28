import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import {
  getRootEnvPath,
  getAppEnvPath,
  getLocalOverridePath,
} from "../../src/core/env-file.ts";
import type { ResolvedConfig, ResolvedAppConfig } from "../../src/types/config.ts";
import type { EnvSyncConfig } from "../../src/types/config.ts";

const rawConfig: EnvSyncConfig = {
  environments: ["local", "staging", "production"],
  envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: true },
  encryption: "none",
  apps: {
    api: {
      path: "apps/api",
      workers: { staging: "api-stg" },
      secrets: ["KEY"],
    },
  },
};

const projectRoot = "/project";

const config: ResolvedConfig = {
  projectRoot,
  raw: rawConfig,
  environments: rawConfig.environments,
  apps: {
    api: {
      name: "api",
      path: "apps/api",
      workers: { staging: "api-stg" },
      secrets: ["KEY"],
      absolutePath: join(projectRoot, "apps/api"),
      allKeys: ["KEY"],
    },
  },
};

const apiApp = config.apps.api!;

describe("getRootEnvPath", () => {
  test("local env returns root/.env", () => {
    expect(getRootEnvPath(config, "local")).toBe(join(projectRoot, ".env"));
  });

  test("staging env returns root/.env.staging", () => {
    expect(getRootEnvPath(config, "staging")).toBe(
      join(projectRoot, ".env.staging"),
    );
  });

  test("production env returns root/.env.production", () => {
    expect(getRootEnvPath(config, "production")).toBe(
      join(projectRoot, ".env.production"),
    );
  });
});

describe("getAppEnvPath", () => {
  test("uses absolutePath + resolved pattern", () => {
    expect(getAppEnvPath(config, apiApp, "staging")).toBe(
      join(projectRoot, "apps/api", ".env.staging"),
    );
  });

  test("local env uses .env in app dir", () => {
    expect(getAppEnvPath(config, apiApp, "local")).toBe(
      join(projectRoot, "apps/api", ".env"),
    );
  });
});

describe("getLocalOverridePath", () => {
  test("returns root + envFiles.local", () => {
    expect(getLocalOverridePath(config)).toBe(
      join(projectRoot, ".env.local"),
    );
  });
});
