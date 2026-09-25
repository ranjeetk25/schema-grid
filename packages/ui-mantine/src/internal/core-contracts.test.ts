import { describe, expect, it } from "vitest";
import {
  BUILT_IN_FIELD_TYPE_IDS,
  type ColumnDef,
  type GridSchema,
  createDefaultRegistry,
  createRolePermissionResolver,
  dependencies,
  inferResultType,
  isFormulaError,
  parseFormula,
  resolveColumnAccess,
  validateFilter,
} from "./core-contracts";

const col = (id: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef => ({
  id,
  key: id,
  label: id,
  type,
  config: {},
  order: 0,
  createdAt: "",
  updatedAt: "",
  ...extra,
});

const schema: GridSchema = {
  id: "s",
  schemaVersion: 1,
  columns: [
    col("pay", "select", { config: { options: [{ label: "Paid", value: "paid" }] } }),
    col("call", "date"),
    col("amount", "currency"),
    col("notes", "longText"),
    col("secret", "text", { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
    col("total", "formula", { formula: "{amount} * 2" }),
  ],
};

describe("core-contracts fallback", () => {
  const registry = createDefaultRegistry();

  it("registers all 16 built-ins with label, configSchema and operators", () => {
    expect(registry.list().map((t) => t.id)).toEqual([...BUILT_IN_FIELD_TYPE_IDS]);
    for (const t of registry.list()) {
      expect(t.label).toBeTruthy();
      expect(t.configSchema.safeParse(t.defaultConfig).success).toBe(true);
    }
    expect(registry.get("number")?.aggregations).toContain("sum");
    expect(registry.get("currency")?.aggregations).toContain("sum");
    expect(registry.get("select")?.operators.find((o) => o.id === "isNot")?.negative).toBe(true);
  });

  it("formats select labels and INR currency", () => {
    const sel = registry.get("select");
    expect(sel?.format("paid", { options: [{ label: "Paid", value: "paid" }] })).toBe("Paid");
    const cur = registry.get("currency");
    expect(cur?.format(123456, cur.defaultConfig)).toBe("₹1,23,456");
  });

  it("validateFilter accepts the §8 filter and flags problems", () => {
    const readable = ["pay", "call", "amount", "notes", "total"];
    const ok = validateFilter(
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
    );
    expect(ok).toEqual([]);
    const bad = validateFilter(
      {
        op: "and",
        children: [
          { columnId: "nope", operator: "is" },
          { columnId: "secret", operator: "is", value: "x" },
          { columnId: "pay", operator: "bogus" },
          { columnId: "pay", operator: "is", value: "" },
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
    expect(bad[4]?.path).toEqual([4, 0]);
  });

  it("parses formulas and infers types", () => {
    const a = parseFormula("{amount} * 2");
    expect(isFormulaError(a)).toBe(false);
    if (!isFormulaError(a)) {
      expect(inferResultType(a, schema)).toBe("number");
      expect(dependencies(a)).toEqual(["amount"]);
    }
    const c = parseFormula('CONCAT({notes}, "x")');
    expect(!isFormulaError(c) && inferResultType(c, schema)).toBe("text");
    const d = parseFormula("DATEADD({call}, 1)");
    expect(!isFormulaError(d) && inferResultType(d, schema)).toBe("date");
    const i = parseFormula('IF(IS_EMPTY({pay}), 0, {amount} + 1)');
    expect(!isFormulaError(i) && inferResultType(i, schema)).toBe("number");
    expect(!isFormulaError(parseFormula("{amount} > 5")) && inferResultType(parseFormula("{amount} > 5") as never, schema)).toBe("boolean");
    const err = parseFormula("{amount} *");
    expect(isFormulaError(err)).toBe(true);
    expect(isFormulaError(err) && typeof err.position).toBe("number");
    expect(isFormulaError(parseFormula("FOO(1)"))).toBe(true);
  });

  it("resolves column access from role permissions", () => {
    const access = resolveColumnAccess(schema, createRolePermissionResolver(), { id: "u", roles: ["counsellor"] });
    expect(access.get("secret")).toBe("hidden");
    expect(access.get("pay")).toBe("edit");
    expect(access.get("total")).toBe("read");
  });
});
