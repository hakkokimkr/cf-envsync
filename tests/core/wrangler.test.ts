import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExecResult } from "../../src/utils/process.ts";

// Instead of mock.module (which leaks across test files), we import the real
// module and use spyOn-style mocking by re-exporting a wrapper.
// We use Bun's mock.module but scope it to just this file.
const mockExecFn = mock<(command: string[], options?: unknown) => Promise<ExecResult>>(() =>
  Promise.resolve({ stdout: "", stderr: "", exitCode: 0, success: true }),
);

// Use mock.module to swap the exec implementation for wrangler's import
mock.module("../../src/utils/process.ts", () => ({
  exec: (...args: unknown[]) => mockExecFn(...(args as [string[], unknown?])),
}));

// Dynamic import after mock is registered
const { checkWrangler, pushSecrets, listSecrets, deleteSecret, updateWranglerVars } = await import(
  "../../src/core/wrangler.ts"
);

beforeEach(() => {
  mockExecFn.mockReset();
  mockExecFn.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, success: true });
});

describe("checkWrangler", () => {
  test("returns true on success", async () => {
    mockExecFn.mockResolvedValueOnce({
      stdout: "3.0.0",
      stderr: "",
      exitCode: 0,
      success: true,
    });
    expect(await checkWrangler()).toBe(true);
    expect(mockExecFn).toHaveBeenCalledWith(["npx", "wrangler", "--version"]);
  });

  test("returns false on failure", async () => {
    mockExecFn.mockResolvedValueOnce({
      stdout: "",
      stderr: "not found",
      exitCode: 1,
      success: false,
    });
    expect(await checkWrangler()).toBe(false);
  });
});

describe("pushSecrets", () => {
  test("handles empty secrets object", async () => {
    mockExecFn.mockResolvedValueOnce({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      success: true,
    });

    const result = await pushSecrets("my-worker", {}, "staging");
    expect(result.success).toBe(true);

    const opts = mockExecFn.mock.calls[0]![1] as { stdin: string };
    expect(opts.stdin).toBe("{}");
  });

  test("passes cwd to exec", async () => {
    mockExecFn.mockResolvedValueOnce({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      success: true,
    });

    await pushSecrets("my-worker", { A: "1" }, "staging", "/my/project");
    const opts = mockExecFn.mock.calls[0]![1] as { cwd: string };
    expect(opts.cwd).toBe("/my/project");
  });

  test("builds correct args with --name only (no --env)", async () => {
    mockExecFn.mockResolvedValueOnce({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      success: true,
    });

    const result = await pushSecrets("my-worker", { KEY: "val" }, "staging", "/tmp");
    expect(result.success).toBe(true);
    expect(result.output).toBe("ok");

    const call = mockExecFn.mock.calls[0]!;
    const args = call[0] as string[];
    expect(args).toContain("wrangler");
    expect(args).toContain("secret");
    expect(args).toContain("bulk");
    expect(args).toContain("--name");
    expect(args).toContain("my-worker");
    expect(args).not.toContain("--env");

    const opts = call[1] as { stdin: string; cwd: string };
    expect(opts.stdin).toBe(JSON.stringify({ KEY: "val" }));
    expect(opts.cwd).toBe("/tmp");
  });

  test("returns failure on error", async () => {
    mockExecFn.mockResolvedValueOnce({
      stdout: "",
      stderr: "auth error",
      exitCode: 1,
      success: false,
    });

    const result = await pushSecrets("my-worker", { K: "v" }, "staging");
    expect(result.success).toBe(false);
    expect(result.output).toBe("auth error");
  });
});

describe("listSecrets", () => {
  test("parses JSON output", async () => {
    mockExecFn.mockResolvedValueOnce({
      stdout: JSON.stringify([
        { name: "SECRET_A", type: "secret_text" },
        { name: "SECRET_B", type: "secret_text" },
      ]),
      stderr: "",
      exitCode: 0,
      success: true,
    });

    const keys = await listSecrets("my-worker", "staging");
    expect(keys).toEqual(["SECRET_A", "SECRET_B"]);
  });

  test("falls back to line-split for non-JSON output", async () => {
    mockExecFn.mockResolvedValueOnce({
      stdout: "SECRET_A\nSECRET_B\nSECRET_C",
      stderr: "",
      exitCode: 0,
      success: true,
    });

    const keys = await listSecrets("my-worker", "staging");
    expect(keys).toEqual(["SECRET_A", "SECRET_B", "SECRET_C"]);
  });

  test("returns empty on failure", async () => {
    mockExecFn.mockResolvedValueOnce({
      stdout: "",
      stderr: "error",
      exitCode: 1,
      success: false,
    });

    const keys = await listSecrets("my-worker", "staging");
    expect(keys).toEqual([]);
  });
});

describe("deleteSecret", () => {
  test("builds correct args with --force and no --env", async () => {
    mockExecFn.mockResolvedValueOnce({
      stdout: "",
      stderr: "",
      exitCode: 0,
      success: true,
    });

    const result = await deleteSecret("my-worker", "MY_KEY", "staging");
    expect(result).toBe(true);

    const args = mockExecFn.mock.calls[0]![0] as string[];
    expect(args).toContain("wrangler");
    expect(args).toContain("secret");
    expect(args).toContain("delete");
    expect(args).toContain("MY_KEY");
    expect(args).toContain("--name");
    expect(args).toContain("my-worker");
    expect(args).toContain("--force");
    expect(args).not.toContain("--env");
  });
});

describe("updateWranglerVars", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "envsync-wrangler-vars-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("preserves comments in wrangler.jsonc", async () => {
    const original = `{
  // Worker name
  "name": "my-api",
  "account_id": "abc123",
  "env": {
    // Staging environment
    "staging": {
      "name": "my-api-staging",
      "vars": {
        // Existing var
        "EXISTING": "keep-me"
      }
    }
  }
}
`;
    writeFileSync(join(tmpDir, "wrangler.jsonc"), original);

    const result = await updateWranglerVars(tmpDir, "staging", { API_URL: "https://staging.example.com" });
    expect(result.success).toBe(true);

    const content = readFileSync(join(tmpDir, "wrangler.jsonc"), "utf-8");
    // Comments preserved
    expect(content).toContain("// Worker name");
    expect(content).toContain("// Staging environment");
    // Existing values preserved
    expect(content).toContain("my-api");
    expect(content).toContain("abc123");
    // New var added
    expect(content).toContain("API_URL");
    expect(content).toContain("https://staging.example.com");
  });

  test("writes to env.{environment}.vars", async () => {
    writeFileSync(join(tmpDir, "wrangler.jsonc"), `{
  "name": "my-api",
  "env": {
    "staging": {
      "name": "my-api-staging"
    }
  }
}
`);

    await updateWranglerVars(tmpDir, "staging", { ENVIRONMENT: "staging" });
    const content = readFileSync(join(tmpDir, "wrangler.jsonc"), "utf-8");
    const parsed = JSON.parse(content.replace(/\/\/.*/g, ""));
    expect(parsed.env.staging.vars.ENVIRONMENT).toBe("staging");
  });

  test("creates env section if missing", async () => {
    writeFileSync(join(tmpDir, "wrangler.json"), `{
  "name": "my-api"
}
`);

    await updateWranglerVars(tmpDir, "production", { API_URL: "https://api.example.com" });
    const content = readFileSync(join(tmpDir, "wrangler.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.env.production.vars.API_URL).toBe("https://api.example.com");
  });

  test("merges with existing vars", async () => {
    writeFileSync(join(tmpDir, "wrangler.jsonc"), `{
  "env": {
    "staging": {
      "vars": {
        "MANUAL_VAR": "keep"
      }
    }
  }
}
`);

    await updateWranglerVars(tmpDir, "staging", { NEW_VAR: "added" });
    const content = readFileSync(join(tmpDir, "wrangler.jsonc"), "utf-8");
    const parsed = JSON.parse(content.replace(/\/\/.*/g, ""));
    expect(parsed.env.staging.vars.MANUAL_VAR).toBe("keep");
    expect(parsed.env.staging.vars.NEW_VAR).toBe("added");
  });

  test("returns failure when no wrangler config found", async () => {
    const result = await updateWranglerVars(tmpDir, "staging", { A: "1" });
    expect(result.success).toBe(false);
  });
});
