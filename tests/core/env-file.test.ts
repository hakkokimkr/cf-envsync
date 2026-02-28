import { describe, test, expect } from "bun:test";
import { mergeEnvLayers, filterForApp, writeEnvFile, loadEnvFile } from "../../src/core/env-file.ts";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ResolvedAppConfig } from "../../src/types/config.ts";

describe("mergeEnvLayers", () => {
  test("merges layers with later layers overriding earlier", () => {
    const result = mergeEnvLayers([
      { source: "root .env", map: { A: "1", B: "2" } },
      { source: "app .env", map: { B: "3", C: "4" } },
    ]);

    expect(result.map).toEqual({ A: "1", B: "3", C: "4" });
    expect(result.entries.find((e) => e.key === "B")?.source).toBe("app .env");
    expect(result.layers).toEqual(["root .env", "app .env"]);
  });

  test("handles empty layers", () => {
    const result = mergeEnvLayers([]);
    expect(result.map).toEqual({});
    expect(result.entries).toEqual([]);
  });

  test("local override layer wins over root", () => {
    const result = mergeEnvLayers([
      { source: ".env", map: { URL: "localhost" } },
      { source: ".env.local", map: { URL: "tunnel.dev" } },
    ]);
    expect(result.map.URL).toBe("tunnel.dev");
    expect(result.entries.find((e) => e.key === "URL")?.source).toBe(".env.local");
  });
});

describe("filterForApp", () => {
  const baseApp: ResolvedAppConfig = {
    name: "api",
    path: "apps/api",
    workers: { staging: "api-stg", production: "api-prod" },
    absolutePath: "/tmp/apps/api",
    secrets: ["DATABASE_URL", "JWT_SECRET"],
    vars: ["API_URL"],
    allKeys: ["DATABASE_URL", "JWT_SECRET", "API_URL"],
  };

  test("only includes declared keys", () => {
    const result = filterForApp(
      { DATABASE_URL: "x", JWT_SECRET: "y", API_URL: "z", EXTRA_KEY: "w" },
      baseApp,
    );
    expect(result).toEqual({ DATABASE_URL: "x", JWT_SECRET: "y", API_URL: "z" });
    expect(result.EXTRA_KEY).toBeUndefined();
  });

  test("returns empty if no matching keys", () => {
    const result = filterForApp({ UNKNOWN: "x" }, baseApp);
    expect(result).toEqual({});
  });
});

describe("writeEnvFile / loadEnvFile", () => {
  test("round-trips simple values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envsync-test-"));
    const filePath = join(dir, ".env.test");

    await writeEnvFile(filePath, {
      SIMPLE: "hello",
      WITH_SPACES: "hello world",
      EMPTY: "",
    });

    const loaded = await loadEnvFile(filePath);
    expect(loaded.SIMPLE).toBe("hello");
    expect(loaded.WITH_SPACES).toBe("hello world");
    expect(loaded.EMPTY).toBe("");

    await rm(dir, { recursive: true });
  });
});
