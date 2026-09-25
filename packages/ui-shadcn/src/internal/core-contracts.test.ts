import { describe, expect, it } from "vitest";
import {
  BUILTIN_FIELD_TYPE_IDS,
  type ColumnDef,
  type GridSchema,
  RELATIVE_DATE_PRESETS,
  createDefaultRegistry,
  createRolePermissionResolver,
  currencySymbol,
  dependencies,
  getColumnOperators,
  inferResultType,
  isFilterGroup,
  isFormulaError,
  parseFormula,
  resolveColumnAccess,
  validateFilter,
  valueMatchesKind,
} from "./core-contracts";

const registry = createDefaultRegistry();

const col = (id: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef => ({
  id,
  key: id,
  label: id,
  type,
  config: registry.get(type)?.defaultConfig ?? {},
  order: 0,
  createdAt: "",
  updatedAt: "",
  ...extra,
});

const schema: GridSchema = {
  id: "s",
  schemaVersion: 1,
  columns: [
    col("pay", "select", { config: { options: [{ id: "paid", label: "Paid" }] } }),
    col("call", "date"),
    col("amount", "currency"),
    col("notes", "longText"),
    col("secret", "text", { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
    col("total", "formula", { formula: "{amount} * 2", config: { resultType: "number" } }),
  ],
};

describe("core-contracts (real @ranjeetk25/schema-grid-core)", () => {
  it("re-exports the default registry with all 16 built-ins", () => {
    expect(registry.list().map((t) => t.id)).toEqual([...BUILTIN_FIELD_TYPE_IDS]);
    expect(registry.get("select")?.operators.find((o) => o.id === "isNot")?.negative).toBe(true);
  });

  it("formula operators follow config.resultType via getColumnOperators", () => {
    const total = schema.columns.find((c) => c.id === "total") as ColumnDef;
    expect(getColumnOperators(total, registry).map((o) => o.id)).toContain("between");
  });

  it("validateFilter accepts the §8 filter and flags problems", () => {
    const readable = new Set(["pay", "call", "amount", "notes", "total"]);
    expect(
      validateFilter(
        {
          op: "and",
          children: [
            { columnId: "pay", operator: "isNot", value: "paid" },
            { columnId: "call", operator: "isWithin", value: { relative: "yesterday" } },
          ],
        },
        schema,
        registry,
        readable,
      ),
    ).toEqual([]);
    const bad = validateFilter(
      {
        op: "and",
        children: [
          { columnId: "nope", operator: "is" },
          { columnId: "secret", operator: "is", value: "x" },
          { columnId: "pay", operator: "bogus" },
          { columnId: "pay", operator: "is", value: null },
          { op: "or", children: [{ op: "and", children: [] }] },
          { columnId: "total", operator: "gt", value: 3 },
        ],
      },
      schema,
      registry,
      readable,
    );
    expect(bad.map((e) => e.code)).toEqual([
      "unknownColumn",
      "unreadableColumn",
      "unknownOperator",
      "valueKindMismatch",
      "depthExceeded",
    ]);
  });

  it("parses formulas and infers types", () => {
    const a = parseFormula("{amount} * 2");
    if (isFormulaError(a)) throw new Error(a.message);
    expect(inferResultType(a, schema)).toBe("number");
    expect(dependencies(a)).toEqual(["amount"]);
    const err = parseFormula("{amount} *");
    expect(isFormulaError(err)).toBe(true);
    expect(isFormulaError(err) && typeof err.start).toBe("number");
  });

  it("resolves column access from role permissions", () => {
    const access = resolveColumnAccess(schema, createRolePermissionResolver(), { id: "u", roles: ["counsellor"] });
    expect(access.get("secret")).toBe("hidden");
    expect(access.get("pay")).toBe("edit");
    expect(access.get("total")).toBe("read");
  });
});

describe("local helpers", () => {
  it("RELATIVE_DATE_PRESETS are exactly the kinds core accepts", () => {
    for (const { kind: relative, needsN } of RELATIVE_DATE_PRESETS) {
      const value = needsN ? { relative, n: 3 } : { relative };
      expect(validateFilter({ columnId: "call", operator: "isWithin", value }, schema, registry, new Set(["call"]))).toEqual([]);
    }
    expect(RELATIVE_DATE_PRESETS).toHaveLength(9);
  });

  it("valueMatchesKind is stricter than core for blank strings", () => {
    expect(validateFilter({ columnId: "notes", operator: "is", value: "" }, schema, registry, new Set(["notes"]))).toEqual([]);
    expect(valueMatchesKind("single", "")).toBe(false);
    expect(valueMatchesKind("single", "x")).toBe(true);
    expect(valueMatchesKind("relativeDate", { relative: "lastNDays" })).toBe(false);
    expect(valueMatchesKind("relativeDate", { relative: "lastNDays", n: 7 })).toBe(true);
  });

  it("isFilterGroup and currencySymbol", () => {
    expect(isFilterGroup({ op: "and", children: [] })).toBe(true);
    expect(isFilterGroup({ columnId: "x", operator: "is" })).toBe(false);
    expect(currencySymbol("INR", "en-IN")).toBe("₹");
  });
});
