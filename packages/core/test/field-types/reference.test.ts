import { describe, expect, it } from "vitest";
import { userFieldType, type UserConfig } from "../../src/field-types/builtins/user";
import { linkFieldType, type LinkConfig } from "../../src/field-types/builtins/link";

const userConfig: UserConfig = {};
const linkConfig: LinkConfig = { target: "projects", multiple: true };
const singleLinkConfig: LinkConfig = { target: "projects", multiple: false };

describe("userFieldType", () => {
  it("parses an id string into { id }", () => {
    expect(userFieldType.parse("u1", userConfig)).toEqual({ ok: true, value: { id: "u1" } });
  });

  it("parses a UserRef object through unchanged", () => {
    const ref = { id: "u1", name: "Asha" };
    expect(userFieldType.parse(ref, userConfig)).toEqual({ ok: true, value: ref });
  });

  it("parses a number id by stringifying it", () => {
    expect(userFieldType.parse(42, userConfig)).toEqual({ ok: true, value: { id: "42" } });
  });

  it("empty input gives null", () => {
    expect(userFieldType.parse("", userConfig)).toEqual({ ok: true, value: null });
    expect(userFieldType.parse(null, userConfig)).toEqual({ ok: true, value: null });
    expect(userFieldType.parse(undefined, userConfig)).toEqual({ ok: true, value: null });
  });

  it("format shows the name, falling back to the id", () => {
    expect(userFieldType.format({ id: "u1", name: "Asha" }, userConfig)).toBe("Asha");
    expect(userFieldType.format({ id: "u1" }, userConfig)).toBe("u1");
    expect(userFieldType.format(null, userConfig)).toBe("");
    expect(userFieldType.format(undefined, userConfig)).toBe("");
  });

  it("compare sorts by name (case-insensitive), then by id", () => {
    expect(
      userFieldType.compare({ id: "u2", name: "asha" }, { id: "u1", name: "Bilal" }, userConfig),
    ).toBeLessThan(0);
    expect(
      userFieldType.compare({ id: "u2", name: "Asha" }, { id: "u1", name: "asha" }, userConfig),
    ).toBeGreaterThan(0);
  });

  it("compare sorts empty values last", () => {
    expect(userFieldType.compare(null, { id: "u1" }, userConfig)).toBeGreaterThan(0);
    expect(userFieldType.compare({ id: "u1" }, null, userConfig)).toBeLessThan(0);
  });

  it("operators include isMe (valueKind 'me') and isNotMe (negative)", () => {
    const isMe = userFieldType.operators.find((o) => o.id === "isMe");
    const isNotMe = userFieldType.operators.find((o) => o.id === "isNotMe");
    expect(isMe?.valueKind).toBe("me");
    expect(isNotMe?.negative).toBe(true);
  });

  it("valueSchema accepts a UserRef or null, rejects a bare string", () => {
    const schema = userFieldType.valueSchema(userConfig);
    expect(schema.safeParse({ id: "u1", name: "Asha" }).success).toBe(true);
    expect(schema.safeParse({ id: "u1" }).success).toBe(true);
    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse({ id: "" }).success).toBe(false);
    expect(schema.safeParse("u1").success).toBe(false);
  });

  it("defaultValue is null", () => {
    expect(userFieldType.defaultValue(userConfig)).toBeNull();
  });

  it("serialize/deserialize round-trip", () => {
    const ref = { id: "u1", name: "Asha" };
    expect(userFieldType.serialize(ref)).toEqual(ref);
    expect(userFieldType.deserialize(ref)).toEqual(ref);
    expect(userFieldType.deserialize(null)).toBeNull();
  });

  it("deserialize of malformed input gives null", () => {
    expect(userFieldType.deserialize("u1")).toBeNull();
    expect(userFieldType.deserialize({ name: "no id" })).toBeNull();
    expect(userFieldType.deserialize(42)).toBeNull();
  });
});

describe("linkFieldType", () => {
  it("parses a comma-separated id list into LinkRefs", () => {
    const result = linkFieldType.parse("a,b", linkConfig);
    expect(result).toEqual({
      ok: true,
      value: [
        { id: "a", label: "a" },
        { id: "b", label: "b" },
      ],
    });
  });

  it("parses a single LinkRef", () => {
    const ref = { id: "p1", label: "Project One" };
    expect(linkFieldType.parse(ref, linkConfig)).toEqual({ ok: true, value: [ref] });
  });

  it("parses an array of LinkRefs", () => {
    const refs = [
      { id: "p1", label: "Project One" },
      { id: "p2", label: "Project Two" },
    ];
    expect(linkFieldType.parse(refs, linkConfig)).toEqual({ ok: true, value: refs });
  });

  it("parses an array of id strings", () => {
    const result = linkFieldType.parse(["a", "b"], linkConfig);
    expect(result).toEqual({
      ok: true,
      value: [
        { id: "a", label: "a" },
        { id: "b", label: "b" },
      ],
    });
  });

  it("dedups by id", () => {
    const result = linkFieldType.parse("a,a,b", linkConfig);
    expect(result).toEqual({
      ok: true,
      value: [
        { id: "a", label: "a" },
        { id: "b", label: "b" },
      ],
    });
  });

  it("fails when multiple is false and more than one ref is given", () => {
    const result = linkFieldType.parse("a,b", singleLinkConfig);
    expect(result.ok).toBe(false);
  });

  it("allows a single ref when multiple is false", () => {
    const result = linkFieldType.parse("a", singleLinkConfig);
    expect(result).toEqual({ ok: true, value: [{ id: "a", label: "a" }] });
  });

  it("empty input gives ok []", () => {
    expect(linkFieldType.parse("", linkConfig)).toEqual({ ok: true, value: [] });
    expect(linkFieldType.parse(null, linkConfig)).toEqual({ ok: true, value: [] });
    expect(linkFieldType.parse(undefined, linkConfig)).toEqual({ ok: true, value: [] });
    expect(linkFieldType.parse([], linkConfig)).toEqual({ ok: true, value: [] });
  });

  it("format joins labels with ', '", () => {
    const refs = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    expect(linkFieldType.format(refs, linkConfig)).toBe("Alpha, Beta");
  });

  it("format of empty/null is ''", () => {
    expect(linkFieldType.format([], linkConfig)).toBe("");
    expect(linkFieldType.format(null, linkConfig)).toBe("");
    expect(linkFieldType.format(undefined, linkConfig)).toBe("");
  });

  it("compare orders by the first label (case-insensitive)", () => {
    expect(
      linkFieldType.compare([{ id: "a", label: "beta" }], [{ id: "b", label: "Alpha" }], linkConfig),
    ).toBeGreaterThan(0);
  });

  it("compare sorts empty arrays last", () => {
    expect(linkFieldType.compare([], [{ id: "a", label: "Alpha" }], linkConfig)).toBeGreaterThan(0);
    expect(linkFieldType.compare([{ id: "a", label: "Alpha" }], [], linkConfig)).toBeLessThan(0);
  });

  it("defaultValue is []", () => {
    expect(linkFieldType.defaultValue(linkConfig)).toEqual([]);
  });

  it("defaultConfig has target '' and multiple true", () => {
    expect(linkFieldType.defaultConfig).toEqual({ target: "", multiple: true });
  });

  it("valueSchema enforces at most one ref when multiple is false", () => {
    const schema = linkFieldType.valueSchema(singleLinkConfig);
    expect(schema.safeParse([{ id: "a", label: "Alpha" }]).success).toBe(true);
    expect(
      schema.safeParse([
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ]).success,
    ).toBe(false);
    expect(schema.safeParse(null).success).toBe(true);
  });

  it("serialize/deserialize round-trip", () => {
    const refs = [{ id: "a", label: "Alpha" }];
    expect(linkFieldType.serialize(refs)).toEqual(refs);
    expect(linkFieldType.deserialize(refs)).toEqual(refs);
    expect(linkFieldType.deserialize(null)).toBeNull();
  });

  it("operators come from LINK_OPERATORS", () => {
    expect(linkFieldType.operators.map((o) => o.id)).toContain("isAnyOf");
  });
});
