import { describe, test, expect } from "bun:test";
import { maskValue } from "../../src/utils/output.ts";

describe("maskValue", () => {
  test("returns (empty) for undefined/empty", () => {
    expect(maskValue(undefined)).toBe("(empty)");
    expect(maskValue("")).toBe("(empty)");
  });

  test("returns **** for short values (<=4 chars)", () => {
    expect(maskValue("ab")).toBe("****");
    expect(maskValue("abcd")).toBe("****");
  });

  test("shows first 4 chars + **** for longer values", () => {
    expect(maskValue("hello_world")).toBe("hell****");
    expect(maskValue("secret_key_123")).toBe("secr****");
  });
});
