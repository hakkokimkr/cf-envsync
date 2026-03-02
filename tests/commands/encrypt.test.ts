import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dir, "../../src/index.ts");

function createTmpProject(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "envsync-encrypt-test-"));

  // Minimal config with password encryption
  writeFileSync(
    join(tmpDir, "envsync.json"),
    JSON.stringify({
      environments: ["local", "staging", "production"],
      envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: false },
      encryption: "password",
      apps: {
        default: {
          path: ".",
          workers: { staging: "my-worker-staging", production: "my-worker" },
          secrets: ["DATABASE_URL", "API_KEY"],
          vars: ["ENVIRONMENT"],
        },
      },
    }),
  );

  return tmpDir;
}

async function runEncrypt(cwd: string, ...args: string[]): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, "run", CLI, "encrypt", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CONSOLA_LEVEL: "5" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { output: stdout + stderr, exitCode };
}

describe("encrypt command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpProject();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("encrypts plain values in .env.staging", async () => {
    writeFileSync(join(tmpDir, ".env.staging"), "DATABASE_URL=postgres://localhost/db\nAPI_KEY=secret123\n");
    writeFileSync(join(tmpDir, ".env.password"), "ENVSYNC_PASSWORD=test-pw\n");

    const { output, exitCode } = await runEncrypt(tmpDir, "staging");
    expect(exitCode).toBe(0);
    expect(output).toContain("DATABASE_URL: encrypted");
    expect(output).toContain("API_KEY: encrypted");

    const content = readFileSync(join(tmpDir, ".env.staging"), "utf-8");
    expect(content).toContain("DATABASE_URL=envsync:v1:");
    expect(content).toContain("API_KEY=envsync:v1:");
  });

  test("skips already-encrypted values", async () => {
    // First encrypt DATABASE_URL
    writeFileSync(join(tmpDir, ".env.staging"), "DATABASE_URL=secret-db-url\n");
    writeFileSync(join(tmpDir, ".env.password"), "ENVSYNC_PASSWORD=test-pw\n");
    await runEncrypt(tmpDir, "staging");

    // Now add a plain value alongside the already-encrypted one
    const encrypted = readFileSync(join(tmpDir, ".env.staging"), "utf-8").trim();
    writeFileSync(join(tmpDir, ".env.staging"), encrypted + "\nAPI_KEY=plain-value\n");

    const { output, exitCode } = await runEncrypt(tmpDir, "staging");
    expect(exitCode).toBe(0);
    expect(output).toContain("API_KEY: encrypted");
    expect(output).not.toContain("DATABASE_URL: encrypted");

    const content = readFileSync(join(tmpDir, ".env.staging"), "utf-8");
    // Both should be encrypted now
    expect(content).toContain("DATABASE_URL=envsync:v1:");
    expect(content).toContain("API_KEY=envsync:v1:");
  });

  test("skips empty values", async () => {
    writeFileSync(join(tmpDir, ".env.staging"), "DATABASE_URL=\nAPI_KEY=secret\n");
    writeFileSync(join(tmpDir, ".env.password"), "ENVSYNC_PASSWORD=test-pw\n");

    const { output, exitCode } = await runEncrypt(tmpDir, "staging");
    expect(exitCode).toBe(0);

    const content = readFileSync(join(tmpDir, ".env.staging"), "utf-8");
    expect(content).toContain("DATABASE_URL=");
    expect(content).not.toContain("DATABASE_URL=envsync:v1:");
  });

  test("dry-run does not modify file", async () => {
    const original = "DATABASE_URL=postgres://localhost/db\n";
    writeFileSync(join(tmpDir, ".env.staging"), original);
    writeFileSync(join(tmpDir, ".env.password"), "ENVSYNC_PASSWORD=test-pw\n");

    const { output, exitCode } = await runEncrypt(tmpDir, "staging", "--dry-run");
    expect(exitCode).toBe(0);
    expect(output).toContain("dry-run");

    const content = readFileSync(join(tmpDir, ".env.staging"), "utf-8");
    expect(content).toBe(original);
  });

  test("errors when no password is found", async () => {
    writeFileSync(join(tmpDir, ".env.staging"), "DATABASE_URL=value\n");
    // No .env.password file, no env var

    const { output, exitCode } = await runEncrypt(tmpDir, "staging");
    expect(exitCode).toBe(1);
    expect(output).toContain("No password found");
  });

  test("errors when encryption is not password", async () => {
    // Overwrite config with dotenvx encryption
    writeFileSync(
      join(tmpDir, "envsync.json"),
      JSON.stringify({
        environments: ["local", "staging"],
        envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: false },
        encryption: "dotenvx",
        apps: { default: { path: ".", workers: { staging: "w" }, secrets: ["A"] } },
      }),
    );
    writeFileSync(join(tmpDir, ".env.staging"), "A=value\n");

    const { output, exitCode } = await runEncrypt(tmpDir, "staging");
    expect(exitCode).toBe(1);
    expect(output).toContain('encryption: "password"');
  });

  test("errors when password differs from existing encrypted values", async () => {
    // First encrypt with password A
    writeFileSync(join(tmpDir, ".env.staging"), "DATABASE_URL=secret\nAPI_KEY=key123\n");
    writeFileSync(join(tmpDir, ".env.password"), "ENVSYNC_PASSWORD=password-A\n");
    const { exitCode: firstExit } = await runEncrypt(tmpDir, "staging");
    expect(firstExit).toBe(0);

    // Now add a plain value and change password to B
    const existing = readFileSync(join(tmpDir, ".env.staging"), "utf-8");
    writeFileSync(join(tmpDir, ".env.staging"), existing + "NEW_KEY=new-value\n");
    writeFileSync(join(tmpDir, ".env.password"), "ENVSYNC_PASSWORD=password-B\n");

    // Should fail because existing values were encrypted with password A
    const { output, exitCode } = await runEncrypt(tmpDir, "staging");
    expect(exitCode).toBe(1);
    expect(output).toContain("Password mismatch");
  });

  test("preserves comments and blank lines", async () => {
    writeFileSync(
      join(tmpDir, ".env.staging"),
      "# staging secrets\n\nDATABASE_URL=pg://db\n# api key below\nAPI_KEY=key123\n",
    );
    writeFileSync(join(tmpDir, ".env.password"), "ENVSYNC_PASSWORD=test-pw\n");

    const { exitCode } = await runEncrypt(tmpDir, "staging");
    expect(exitCode).toBe(0);

    const content = readFileSync(join(tmpDir, ".env.staging"), "utf-8");
    expect(content).toContain("# staging secrets");
    expect(content).toContain("# api key below");
  });
});
