import { describe, expect, it } from "vitest";
import { z } from "zod";
import { z as z4 } from "zod/v4";
import { createDefaultRegistry } from "../../internal/core-contracts";
import { type FormFieldDescriptor, introspectZod } from "./introspect";

function childrenOf(d: FormFieldDescriptor) {
  if (d.kind !== "object") throw new Error(`expected object, got ${d.kind}`);
  return d.children;
}

function child(d: FormFieldDescriptor, key: string): FormFieldDescriptor {
  const found = childrenOf(d).find((c) => c.key === key);
  if (!found) throw new Error(`missing child ${key}`);
  return found.field;
}

// Both majors expose the same builder surface for everything these tests use.
type Builder = typeof z | typeof z4;
const majors: Array<[string, Builder]> = [
  ["zod v3", z],
  ["zod v4", z4],
];

describe.each(majors)("introspectZod (%s)", (_name, zz) => {
  // biome-ignore lint/suspicious/noExplicitAny: the two majors' builder unions are not callable as one type
  const b = zz as any;

  it("maps primitives and enums in key order", () => {
    const d = introspectZod(
      b.object({ name: b.string(), count: b.number(), active: b.boolean(), size: b.enum(["s", "m", "l"]) }),
    );
    expect(childrenOf(d).map((c) => c.key)).toEqual(["name", "count", "active", "size"]);
    expect(child(d, "name").kind).toBe("string");
    expect(child(d, "count").kind).toBe("number");
    expect(child(d, "active").kind).toBe("boolean");
    expect(child(d, "size")).toMatchObject({ kind: "enum", values: ["s", "m", "l"], optional: false });
  });

  it("marks optional and reads defaults", () => {
    const d = introspectZod(b.object({ a: b.string().optional(), n: b.number().default(2) }));
    expect(child(d, "a")).toMatchObject({ kind: "string", optional: true });
    expect(child(d, "n")).toMatchObject({ kind: "number", defaultValue: 2 });
  });

  it("unwraps nullable", () => {
    expect(introspectZod(b.string().nullable())).toMatchObject({ kind: "string", optional: true });
  });

  it("reads number min/max/int", () => {
    expect(introspectZod(b.number().int().min(1).max(10))).toMatchObject({ kind: "number", min: 1, max: 10, int: true });
  });

  it("reads descriptions", () => {
    expect(introspectZod(b.string().describe("Hello")).description).toBe("Hello");
  });

  it("maps an array of {label,value,color?} to optionList", () => {
    const withColor = introspectZod(b.array(b.object({ label: b.string(), value: b.string(), color: b.string().optional() })));
    expect(withColor).toMatchObject({ kind: "optionList", hasColor: true });
    const noColor = introspectZod(b.array(b.object({ label: b.string(), value: b.string() })));
    expect(noColor).toMatchObject({ kind: "optionList", hasColor: false });
  });

  it("maps a plain array to unsupported", () => {
    expect(introspectZod(b.array(b.string())).kind).toBe("unsupported");
  });

  it("maps union and record to unsupported with a reason", () => {
    const u = introspectZod(b.union([b.string(), b.number()]));
    expect(u.kind).toBe("unsupported");
    if (u.kind === "unsupported") expect(u.reason).toMatch(/union/i);
    expect(introspectZod(b.record(b.string(), b.string())).kind).toBe("unsupported");
  });

  it("unwraps a transform to its input type", () => {
    expect(introspectZod(b.string().transform((s: string) => s.length)).kind).toBe("string");
  });

  it("maps nested objects", () => {
    const d = introspectZod(b.object({ inner: b.object({ x: b.number() }) }));
    expect(child(child(d, "inner"), "x").kind).toBe("number");
  });
});

describe("introspectZod (v4 plain-object mock)", () => {
  it("reads the _zod.def shape without the zod package", () => {
    let calls = 0;
    const mock = {
      _zod: {
        def: {
          type: "object",
          shape: {
            title: { _zod: { def: { type: "string" } } },
            limit: {
              _zod: {
                def: {
                  type: "default",
                  get defaultValue() {
                    calls += 1;
                    return 5;
                  },
                  innerType: { _zod: { def: { type: "number" } } },
                },
              },
            },
            kind: { _zod: { def: { type: "optional", innerType: { _zod: { def: { type: "enum", entries: { a: "a", b: "b" } } } } } } },
            options: {
              _zod: {
                def: {
                  type: "array",
                  element: {
                    _zod: {
                      def: {
                        type: "object",
                        shape: { label: { _zod: { def: { type: "string" } } }, value: { _zod: { def: { type: "string" } } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const d = introspectZod(mock);
    expect(childrenOf(d).map((c) => c.key)).toEqual(["title", "limit", "kind", "options"]);
    expect(child(d, "title").kind).toBe("string");
    expect(child(d, "limit")).toMatchObject({ kind: "number", defaultValue: 5 });
    expect(calls).toBeGreaterThan(0);
    expect(child(d, "kind")).toMatchObject({ kind: "enum", values: ["a", "b"], optional: true });
    expect(child(d, "options")).toMatchObject({ kind: "optionList", hasColor: false });
  });
});

describe("introspectZod (robustness + core)", () => {
  it("never throws on junk input", () => {
    for (const junk of [undefined, null, 42, "x", {}, { _def: {} }, { _zod: {} }, { _zod: { def: { type: "wat" } } }]) {
      expect(introspectZod(junk).kind).toBe("unsupported");
    }
  });

  it("maps the core select configSchema to object > optionList with a [] default", () => {
    const schema = createDefaultRegistry().get("select")?.configSchema;
    const d = introspectZod(schema);
    expect(child(d, "options")).toMatchObject({ kind: "optionList", hasColor: true, defaultValue: [] });
  });
});
