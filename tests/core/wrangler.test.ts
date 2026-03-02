import { describe, test, expect, mock, beforeEach } from "bun:test";
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
const { checkWrangler, pushSecrets, listSecrets, deleteSecret } = await import(
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
