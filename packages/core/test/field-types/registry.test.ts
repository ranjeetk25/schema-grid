import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ColumnDef } from "../../src/schema/types";
import {
  getColumnFieldType,
  getColumnOperators,
  resolveFormulaOperandTypeId,
} from "../../src/field-types/column-operators";
import { compareWithEmptyLast, isEmptyValue } from "../../src/field-types/empty";
import { createFieldTypeRegistry } from "../../src/field-types/registry";
import type { AnyFieldType, FieldType, ParseResult } from "../../src/field-types/types";

interface StubConfig {
  greeting: string;
}

const stubOperators = [
  { id: "is", label: "is", valueKind: "single" as const },
  { id: "isEmpty", label: "is empty", valueKind: "none" as const },
];

function makeStubFieldType(id: string): FieldType<string, StubConfig> {
  const configSchema = z.object({ greeting: z.string() });
  const defaultConfig: StubConfig = { greeting: "hello" };
  return {
    id,
    label: "Stub",
    configSchema,
    defaultConfig,
    valueSchema: () => z.string().nullable(),
    parse: (input): ParseResult<string | null> => {
      if (typeof input === "string") return { ok: true, value: input };
      return { ok: false, error: "expected string" };
    },
    format: (value) => value ?? "",
    serialize: (value) => value,
    deserialize: (raw) => (typeof raw === "string" ? raw : null),
    compare: (a, b) => (a ?? "").localeCompare(b ?? ""),
    operators: stubOperators,
    defaultValue: () => null,
  };
}

interface NumberConfig {
  precision: number;
}

function makeNumberFieldType(): FieldType<number, NumberConfig> {
  const configSchema = z.object({ precision: z.number() });
  const defaultConfig: NumberConfig = { precision: 0 };
  return {
    id: "number",
    label: "Number",
    configSchema,
    defaultConfig,
    valueSchema: () => z.number().nullable(),
    parse: (input): ParseResult<number | null> => {
      const n = typeof input === "number" ? input : Number(input);
      if (Number.isNaN(n)) return { ok: false, error: "not a number" };
      return { ok: true, value: n };
    },
    format: (value, config) => (value === null || value === undefined ? "" : value.toFixed(config.precision)),
    serialize: (value) => value,
    deserialize: (raw) => (typeof raw === "number" ? raw : null),
    compare: (a, b) => (a ?? 0) - (b ?? 0),
    operators: [
      { id: "eq", label: "=", valueKind: "single" },
      { id: "isEmpty", label: "is empty", valueKind: "none" },
    ],
    fillSeries: (values, count) => {
      const last = values[values.length - 1] ?? 0;
      return Array.from({ length: count }, (_, i) => last + i + 1);
    },
    aggregations: ["sum", "avg"],
    defaultValue: (config) => config.precision,
  };
}

describe("field-types type erasure", () => {
  it("allows a concrete FieldType<number, NumberConfig> to be used as AnyFieldType", () => {
    const numberType: FieldType<number, NumberConfig> = makeNumberFieldType();
    const erased: AnyFieldType = numberType;
    expect(erased.id).toBe("number");
  });
});

describe("createFieldTypeRegistry", () => {
  it("register then get returns the same instance", () => {
    const registry = createFieldTypeRegistry();
    const stub = makeStubFieldType("stub");
    registry.register(stub);
    expect(registry.get("stub")).toBe(stub);
  });

  it("has reflects registration", () => {
    const registry = createFieldTypeRegistry();
    expect(registry.has("stub")).toBe(false);
    registry.register(makeStubFieldType("stub"));
    expect(registry.has("stub")).toBe(true);
  });

  it("list keeps insertion order", () => {
    const registry = createFieldTypeRegistry();
    const a = makeStubFieldType("a");
    const b = makeStubFieldType("b");
    const c = makeStubFieldType("c");
    registry.register(b);
    registry.register(a);
    registry.register(c);
    expect(registry.list().map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("registering the same id twice throws", () => {
    const registry = createFieldTypeRegistry();
    registry.register(makeStubFieldType("stub"));
    expect(() => registry.register(makeStubFieldType("stub"))).toThrow();
  });

  it("accepts a numeric FieldType via createFieldTypeRegistry seed and register", () => {
    const numberType = makeNumberFieldType();
    const registry = createFieldTypeRegistry([numberType]);
    expect(registry.get("number")).toBe(numberType);
  });

  it("get returns undefined for an unknown id", () => {
    const registry = createFieldTypeRegistry();
    expect(registry.get("nope")).toBeUndefined();
  });
});

describe("isEmptyValue", () => {
  it("is true for null, undefined, '', '   ' and []", () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue("")).toBe(true);
    expect(isEmptyValue("   ")).toBe(true);
    expect(isEmptyValue([])).toBe(true);
  });

  it("is false for 0, false and 'a'", () => {
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue("a")).toBe(false);
  });
});

describe("compareWithEmptyLast", () => {
  const numericCmp = (a: number | null, b: number | null) => (a ?? 0) - (b ?? 0);

  it("puts empties after non-empties regardless of the comparator", () => {
    expect(compareWithEmptyLast(1, null, numericCmp)).toBeLessThan(0);
    expect(compareWithEmptyLast(null, 1, numericCmp)).toBeGreaterThan(0);
    expect(compareWithEmptyLast(null, null, numericCmp)).toBe(0);
    // even with a comparator that would order these the other way, empties
    // still sort last.
    const reversedCmp = (a: number | null, b: number | null) => (b ?? 0) - (a ?? 0);
    expect(compareWithEmptyLast(1, null, reversedCmp)).toBeLessThan(0);
    expect(compareWithEmptyLast(null, 1, reversedCmp)).toBeGreaterThan(0);
  });

  it("defers to cmp when neither side is empty", () => {
    expect(compareWithEmptyLast(1, 2, numericCmp)).toBeLessThan(0);
    expect(compareWithEmptyLast(2, 1, numericCmp)).toBeGreaterThan(0);
  });
});

describe("getColumnFieldType / getColumnOperators", () => {
  function makeColumn(overrides: Partial<ColumnDef>): ColumnDef {
    return {
      id: "col-1",
      key: "col1",
      label: "Col 1",
      type: "stub",
      config: {},
      order: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("getColumnFieldType returns the registered field type for the column's type", () => {
    const registry = createFieldTypeRegistry();
    const stub = makeStubFieldType("stub");
    registry.register(stub);
    expect(getColumnFieldType(makeColumn({ type: "stub" }), registry)).toBe(stub);
  });

  it("getColumnOperators returns the stub's operators for a stub column", () => {
    const registry = createFieldTypeRegistry();
    registry.register(makeStubFieldType("stub"));
    const column = makeColumn({ type: "stub" });
    expect(getColumnOperators(column, registry)).toEqual(stubOperators);
  });

  it("for a formula column with resultType 'number', returns the operators of the registered 'number' type", () => {
    const registry = createFieldTypeRegistry();
    const numberType = makeNumberFieldType();
    registry.register(numberType);
    const column = makeColumn({ type: "formula", config: { resultType: "number" } });
    expect(getColumnOperators(column, registry)).toEqual(numberType.operators);
  });

  it("returns an empty array for an unknown type id", () => {
    const registry = createFieldTypeRegistry();
    const column = makeColumn({ type: "unknownType" });
    expect(getColumnOperators(column, registry)).toEqual([]);
  });

  it("resolveFormulaOperandTypeId maps result types and defaults to text", () => {
    expect(resolveFormulaOperandTypeId("number")).toBe("number");
    expect(resolveFormulaOperandTypeId("text")).toBe("text");
    expect(resolveFormulaOperandTypeId("boolean")).toBe("boolean");
    expect(resolveFormulaOperandTypeId("date")).toBe("datetime");
    expect(resolveFormulaOperandTypeId(undefined)).toBe("text");
  });
});
