import { describe, expect, it } from "vitest";
import { normalizeCapabilities } from "../../src/datasource/capabilities";
import { fieldTypeAvailability, fieldTypeUnavailableMessage } from "../../src/field-types/availability";
import { createDefaultRegistry } from "../../src/field-types/default-registry";
import { textFieldType } from "../../src/field-types/builtins/text";

const none = normalizeCapabilities({ lookup: false, options: false });
const full = normalizeCapabilities();

describe("fieldTypeAvailability", () => {
  it("link needs lookup, user needs options", () => {
    expect(fieldTypeAvailability("link", none)).toEqual({ available: false, reason: "Linking isn't set up for this grid" });
    expect(fieldTypeAvailability("user", none)).toEqual({
      available: false,
      reason: "People search isn't set up for this grid",
    });
    expect(fieldTypeAvailability("link", full)).toEqual({ available: true });
    expect(fieldTypeAvailability("user", full)).toEqual({ available: true });
    expect(fieldTypeAvailability("user", normalizeCapabilities({ lookup: false }))).toEqual({ available: true });
  });

  it("other types and unknown capabilities are available", () => {
    expect(fieldTypeAvailability("text", none)).toEqual({ available: true });
    expect(fieldTypeAvailability("select", none)).toEqual({ available: true });
    expect(fieldTypeAvailability("link", undefined)).toEqual({ available: true });
    expect(fieldTypeAvailability("link", {})).toEqual({ available: true });
  });

  it("the built-in link / user field types declare the same requirements", () => {
    const registry = createDefaultRegistry();
    expect(registry.get("link")?.requires).toEqual(["lookup"]);
    expect(registry.get("user")?.requires).toEqual(["options"]);
    expect(fieldTypeAvailability("link", none, registry).available).toBe(false);
  });

  it("custom types declare requirements with `requires`", () => {
    const registry = createDefaultRegistry();
    registry.register({ ...textFieldType, id: "company", label: "Company", requires: ["lookup"] });
    registry.register({ ...textFieldType, id: "tagger", label: "Tagger", requires: ["options"] });
    expect(fieldTypeAvailability("company", none, registry)).toEqual({
      available: false,
      reason: "Linking isn't set up for this grid",
    });
    expect(fieldTypeAvailability("tagger", none, registry)).toEqual({
      available: false,
      reason: "Option search isn't set up for this grid",
    });
    expect(fieldTypeAvailability("company", full, registry)).toEqual({ available: true });
    expect(fieldTypeAvailability("company", none)).toEqual({ available: true }); // unknown without the registry
  });
});

describe("fieldTypeUnavailableMessage", () => {
  it("names the column and why the grid can't back it", () => {
    expect(fieldTypeUnavailableMessage("Program", "link")).toBe(
      '"Program" can\'t be a link column: this grid has no records to link to',
    );
    expect(fieldTypeUnavailableMessage("Owner", "user")).toBe(
      '"Owner" can\'t be a user column: this grid has no people to pick from',
    );
    expect(fieldTypeUnavailableMessage("Co", "company")).toBe('"Co" can\'t be a company column: this grid doesn\'t support it');
  });
});
