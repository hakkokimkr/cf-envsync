import { describe, test, expect, afterEach } from "bun:test";
import { decryptEnvContent, findPrivateKey } from "../../src/core/encryption.ts";

describe("decryptEnvContent", () => {
  test("parses plain unencrypted content", () => {
    const content = "FOO=bar\nBAZ=qux\n";
    const result = decryptEnvContent(content);
    expect(result.FOO).toBe("bar");
    expect(result.BAZ).toBe("qux");
  });

  test("parses content with comments and empty lines", () => {
    const content = "# comment\n\nFOO=bar\n";
    const result = decryptEnvContent(content);
    expect(result.FOO).toBe("bar");
    expect(result["# comment"]).toBeUndefined();
  });

  test("restores env vars after key injection", () => {
    const prev = process.env.DOTENV_PRIVATE_KEY;
    const content = "KEY=value\n";
    decryptEnvContent(content, "some-fake-key");
    // After call, DOTENV_PRIVATE_KEY should be restored
    if (prev !== undefined) {
      expect(process.env.DOTENV_PRIVATE_KEY).toBe(prev);
    } else {
      expect(process.env.DOTENV_PRIVATE_KEY).toBeUndefined();
    }
  });
});

describe("findPrivateKey", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    delete process.env.DOTENV_PRIVATE_KEY;
    delete process.env.DOTENV_PRIVATE_KEY_STAGING;
    delete process.env.DOTENV_PRIVATE_KEY_PRODUCTION;
    if (originalEnv.DOTENV_PRIVATE_KEY) {
      process.env.DOTENV_PRIVATE_KEY = originalEnv.DOTENV_PRIVATE_KEY;
    }
  });

  test("returns env-specific key when available", () => {
    process.env.DOTENV_PRIVATE_KEY_STAGING = "staging-key";
    process.env.DOTENV_PRIVATE_KEY = "default-key";
    expect(findPrivateKey("staging")).toBe("staging-key");
  });

  test("falls back to DOTENV_PRIVATE_KEY", () => {
    delete process.env.DOTENV_PRIVATE_KEY_STAGING;
    process.env.DOTENV_PRIVATE_KEY = "default-key";
    expect(findPrivateKey("staging")).toBe("default-key");
  });

  test("returns undefined when no key set", () => {
    delete process.env.DOTENV_PRIVATE_KEY;
    delete process.env.DOTENV_PRIVATE_KEY_STAGING;
    expect(findPrivateKey("staging")).toBeUndefined();
  });

  test("returns DOTENV_PRIVATE_KEY when no env specified", () => {
    process.env.DOTENV_PRIVATE_KEY = "default-key";
    expect(findPrivateKey()).toBe("default-key");
  });
});
