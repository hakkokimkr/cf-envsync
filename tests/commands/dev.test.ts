import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileExists } from "../../src/utils/fs.ts";
import { loadEnvFile } from "../../src/core/env-file.ts";

const FIXTURE = join(import.meta.dir, "../fixtures/sample-project");
const CLI = join(import.meta.dir, "../../src/index.ts");
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

let tmpDirs: string[] = [];

async function setupTmpProject(): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), "envsync-dev-test-"));
  tmpDirs.push(tmpDir);
  for (const f of [".env", ".env.example", ".env.staging", ".env.production", ".env.local", "envsync.json"]) {
    await copyFile(join(FIXTURE, f), join(tmpDir, f));
  }
  for (const app of ["api", "web", "stream-collector"]) {
    await mkdir(join(tmpDir, "apps", app), { recursive: true });
  }
  return tmpDir;
}

afterAll(async () => {
  for (const d of tmpDirs) {
    await rm(d, { recursive: true }).catch(() => {});
  }
});

describe("dev command", () => {
  test("writes correct .dev.vars files", async () => {
    const dir = await setupTmpProject();
    const proc = Bun.spawn([process.execPath, "run", CLI, "dev"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const apiDevVars = join(dir, "apps", "api", ".dev.vars");
    expect(fileExists(apiDevVars)).toBe(true);

    const apiEnv = await loadEnvFile(apiDevVars);
    expect(apiEnv.DATABASE_URL).toBe("postgres://localhost:5432/enterfun_dev");
    expect(apiEnv.JWT_SECRET).toBe("dev_jwt_secret");

    const webDevVars = join(dir, "apps", "web", ".dev.vars");
    expect(fileExists(webDevVars)).toBe(true);

    const webEnv = await loadEnvFile(webDevVars);
    expect(webEnv.AUTH_SECRET).toBe("dev_auth_secret");
    expect(webEnv.VITE_API_URL).toBe("http://localhost:8787");
  });

  test("dry-run does not write .dev.vars", async () => {
    const dir = await setupTmpProject();
    const proc = Bun.spawn([process.execPath, "run", CLI, "dev", "--dry-run"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const apiDevVars = join(dir, "apps", "api", ".dev.vars");
    expect(fileExists(apiDevVars)).toBe(false);
  });

  test("app filter works", async () => {
    const dir = await setupTmpProject();
    const proc = Bun.spawn([process.execPath, "run", CLI, "dev", "api"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(fileExists(join(dir, "apps", "api", ".dev.vars"))).toBe(true);
    expect(fileExists(join(dir, "apps", "web", ".dev.vars"))).toBe(false);
    expect(fileExists(join(dir, "apps", "stream-collector", ".dev.vars"))).toBe(false);
  });
});
