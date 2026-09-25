import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../../../src/internal/core";
import { choiceOptionIds, choiceRank } from "../../../src/sql/choice-order";
import { renderSql } from "../../helpers/sql";

const column = (options: unknown): ColumnDef =>
  ({ id: "s", key: "s", label: "S", type: "select", config: { options } }) as unknown as ColumnDef;

describe("choice order", () => {
  it("option ids in config order; malformed entries skipped, first duplicate wins (core safeOptions/findIndex)", () => {
    expect(
      choiceOptionIds(column([{ id: "b", label: "B" }, { id: 1, label: "x" }, null, { id: "a", label: "A" }, { id: "b", label: "B2" }])),
    ).toEqual(["b", "a"]);
    expect(choiceOptionIds(column(undefined))).toEqual([]);
  });

  it("rank is the option index, unknown ids rank options.length; no options → constant 0", () => {
    const r = renderSql(choiceRank(sql`v`, column([{ id: "x", label: "X" }, { id: "y", label: "Y" }])));
    expect(r.sql).toBe(
      "(CASE WHEN CONVERT(v USING utf8mb4) COLLATE utf8mb4_bin = ? THEN 0 WHEN CONVERT(v USING utf8mb4) COLLATE utf8mb4_bin = ? THEN 1 ELSE 2 END)",
    );
    expect(r.params).toEqual(["x", "y"]);
    expect(renderSql(choiceRank(sql`v`, column([]))).sql).toBe("0");
  });
});
