import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "../../../src/errors";
import { assertSafeColumnKey, generatedColumnName, jsonPath } from "../../../src/storage/keys";

describe("keys", () => {
  it("accepts safe keys", () => {
    expect(assertSafeColumnKey("payment_status")).toBe("payment_status");
    expect(assertSafeColumnKey("a".repeat(48))).toHaveLength(48);
  });
  it.each(["a.b", "a'b", "$x", "", "a".repeat(49), "1abc", "a b", "a`b"])("rejects %j", (k) => {
    expect(() => assertSafeColumnKey(k)).toThrow(SchemaValidationError);
  });
  it("builds json paths", () => {
    expect(jsonPath("callDate")).toBe("$.callDate");
    expect(jsonPath("owner", "id")).toBe("$.owner.id");
    expect(jsonPath("links", "[*].id")).toBe("$.links[*].id");
    expect(() => jsonPath("x", "a'b")).toThrow();
  });
  it("names generated columns", () => {
    expect(generatedColumnName("fee")).toBe("gc_fee");
  });
});
