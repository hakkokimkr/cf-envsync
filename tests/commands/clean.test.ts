import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileExists } from "../../src/utils/fs.ts";

const CLI = join(import.meta.dir, "../../src/index.ts");
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

let tmpDirs: string[] = [];

async function setupCleanProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "envsync-clean-test-"));
  tmpDirs.push(dir);

  const config = {
    environments: ["local", "staging", "production"],
    envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: false },
    encryption: "none",
    apps: {
      api: {
        path: "apps/api",
        workers: { staging: "my-api-staging", production: "my-api" },
        secrets: ["DB_URL"],
        vars: ["API_URL"],
      },
      web: {
        path: "apps/web",
        workers: { staging: "my-web-staging" },
        vars: ["VITE_API_URL"],
      },
    },
  };
  await writeFile(join(dir, "envsync.json"), JSON.stringify(config, null, 2));

  // Create app directories
  await mkdir(join(dir, "apps", "api"), { recursive: true });
  await mkdir(join(dir, "apps", "web"), { recursive: true });

  // Create dev files (simulating envsync dev output)
  await writeFile(join(dir, "apps", "api", ".dev.vars"), "DB_URL=postgres://localhost\nAPI_URL=http://localhost\n");
  await writeFile(join(dir, "apps", "web", ".dev.vars"), "VITE_API_URL=http://localhost\n");

  // Create .env source file
  await writeFile(join(dir, ".env"), "DB_URL=postgres://localhost\nAPI_URL=http://localhost\nVITE_API_URL=http://localhost\n");

  // Create wrangler.jsonc with vars (simulating envsync push output)
  await writeFile(join(dir, "apps", "api", "wrangler.jsonc"), `{
  // API Worker config
  "name": "my-api",
  "env": {
    // Staging environment
    "staging": {
      "name": "my-api-staging",
      "vars": {
        "API_URL": "https://staging.example.com"
      }
    },
    "production": {
      "name": "my-api",
      "vars": {
        "API_URL": "https://api.example.com"
      }
    }
  }
}
`);

  await writeFile(join(dir, "apps", "web", "wrangler.jsonc"), `{
  "name": "my-web",
  "env": {
    "staging": {
      "name": "my-web-staging",
      "vars": {
        "VITE_API_URL": "https://staging.example.com"
      }
    }
  }
}
`);

  return dir;
}

afterAll(async () => {
  for (const d of tmpDirs) {
    await rm(d, { recursive: true }).catch(() => {});
  }
});

describe("clean command", () => {
  test("removes dev files and wrangler vars", async () => {
    const dir = await setupCleanProject();

    // Verify files exist before clean
    expect(fileExists(join(dir, "apps", "api", ".dev.vars"))).toBe(true);
    expect(fileExists(join(dir, "apps", "web", ".dev.vars"))).toBe(true);

    const proc = Bun.spawn([process.execPath, "run", CLI, "clean"], {
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

    // Dev files should be removed
    expect(fileExists(join(dir, "apps", "api", ".dev.vars"))).toBe(false);
    expect(fileExists(join(dir, "apps", "web", ".dev.vars"))).toBe(false);

    // Wrangler vars should be removed
    const apiWrangler = await readFile(join(dir, "apps", "api", "wrangler.jsonc"), "utf-8");
    expect(apiWrangler).not.toContain('"vars"');
    expect(apiWrangler).toContain("// API Worker config");
    expect(apiWrangler).toContain("// Staging environment");
    expect(apiWrangler).toContain('"my-api-staging"');

    const webWrangler = await readFile(join(dir, "apps", "web", "wrangler.jsonc"), "utf-8");
    expect(webWrangler).not.toContain('"vars"');
    expect(webWrangler).toContain('"my-web-staging"');
  });

  test("dry-run does not remove files", async () => {
    const dir = await setupCleanProject();

    const proc = Bun.spawn([process.execPath, "run", CLI, "clean", "--dry-run"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Files should NOT be removed
    expect(fileExists(join(dir, "apps", "api", ".dev.vars"))).toBe(true);
    expect(fileExists(join(dir, "apps", "web", ".dev.vars"))).toBe(true);

    // Wrangler vars should NOT be removed
    const apiWrangler = await readFile(join(dir, "apps", "api", "wrangler.jsonc"), "utf-8");
    expect(apiWrangler).toContain('"vars"');

    // Output should mention what would be removed
    const output = stdout + stderr;
    expect(output).toContain("Would remove");
  });

  test("no error when files don't exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envsync-clean-empty-"));
    tmpDirs.push(dir);

    const config = {
      environments: ["local", "staging"],
      envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: false },
      encryption: "none",
      apps: {
        api: {
          path: "apps/api",
          workers: { staging: "my-api-staging" },
          vars: ["API_URL"],
        },
      },
    };
    await writeFile(join(dir, "envsync.json"), JSON.stringify(config));
    await mkdir(join(dir, "apps", "api"), { recursive: true });
    await writeFile(join(dir, ".env"), "API_URL=test\n");

    const proc = Bun.spawn([process.execPath, "run", CLI, "clean"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    const exitCode = await proc.exited;
    await new Response(proc.stdout).text();
    await new Response(proc.stderr).text();

    expect(exitCode).toBe(0);
  });

  test("preserves wrangler.jsonc comments when removing vars", async () => {
    const { removeWranglerVars } = await import("../../src/core/wrangler.ts");

    const dir = await mkdtemp(join(tmpdir(), "envsync-clean-wrangler-"));
    tmpDirs.push(dir);

    await writeFile(join(dir, "wrangler.jsonc"), `{
  // Main worker config
  "name": "my-api",
  "account_id": "abc123",
  "env": {
    // Staging
    "staging": {
      "name": "my-api-staging",
      "vars": {
        "API_URL": "https://staging.example.com"
      }
    }
  }
}
`);

    const result = await removeWranglerVars(dir, ["staging"]);
    expect(result.success).toBe(true);
    expect(result.removedCount).toBe(1);

    const content = await readFile(join(dir, "wrangler.jsonc"), "utf-8");
    expect(content).toContain("// Main worker config");
    expect(content).toContain("// Staging");
    expect(content).toContain('"my-api-staging"');
    expect(content).not.toContain('"vars"');
    expect(content).not.toContain("API_URL");

    // Verify it's still valid JSONC
    const stripped = content.replace(/\/\/.*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const parsed = JSON.parse(stripped);
    expect(parsed.name).toBe("my-api");
    expect(parsed.env.staging.name).toBe("my-api-staging");
    expect(parsed.env.staging.vars).toBeUndefined();
  });
});
