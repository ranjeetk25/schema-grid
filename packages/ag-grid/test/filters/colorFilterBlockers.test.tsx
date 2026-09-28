/**
 * v0.4.1: color rules the server can't evaluate block filtering by color —
 * `colorFilterBlockedReason`, `columnOperatorsWithColors(…, colorRules)` and
 * the column filters reading `context.colorRules()`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("ag-grid-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ag-grid-react")>();
  return { ...actual, useGridFilter: () => {} };
});

import { ConditionFilter } from "../../src/filters/ConditionFilter";
import { SetFilter } from "../../src/filters/SetFilter";
import { colorFilterBlockedReason, columnOperatorsWithColors } from "../../src/filters/colorOperators";
import {
  type ColorRule,
  type ColumnDef,
  createDefaultRegistry,
  type GridSchema,
  mergeCapabilities,
  normalizeCapabilities,
} from "../../src/internal/core";
import { col, PAYMENT_OPTIONS } from "../fixtures/schema";

const registry = createDefaultRegistry();
const name = col({ id: "name", type: "text", label: "Name" });
const verdict = col({ id: "verdict", type: "text", label: "Verdict", filterable: false });
const payment = col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } });
const schema: GridSchema = { id: "g", schemaVersion: 1, columns: [name, verdict, payment] };
const caps = normalizeCapabilities({ cellColors: { read: true, write: true, filter: true } });
const effective = mergeCapabilities(schema, caps);

const verdictRule: ColorRule = {
  id: "v",
  color: "red",
  target: { kind: "cells", columnIds: ["verdict", "payment"] },
  when: { columnId: "verdict", operator: "isEmpty" },
};
const nameRule: ColorRule = {
  id: "n",
  color: "green",
  target: { kind: "cells", columnIds: ["name"] },
  when: { columnId: "name", operator: "isNotEmpty" },
};
const REASON = 'a color rule on it uses "Verdict", which can\'t be filtered on the server';

function props(column: ColumnDef, rules: readonly ColorRule[]) {
  const context = {
    dataSource: { fetch: vi.fn(), applyChanges: vi.fn() },
    events: () => undefined,
    schema,
    effectiveCapabilities: effective,
    colorRules: () => rules,
  };
  const colDef = { colId: column.id, cellRendererParams: { schemaColumn: column, fieldType: registry.get(column.type) } };
  // biome-ignore lint/suspicious/noExplicitAny: fake AG Grid props for a direct render.
  const p: any = { model: null, onModelChange: vi.fn(), onUiChange: vi.fn(), colDef, column: {}, api: {}, context };
  return p;
}

afterEach(() => cleanup());

describe("colorFilterBlockedReason", () => {
  it("names the first unfilterable column of a rule that can color the column", () => {
    expect(colorFilterBlockedReason(verdict, [verdictRule], schema)).toBe(REASON);
    expect(colorFilterBlockedReason(payment, [nameRule, verdictRule], schema, effective)).toBe(REASON);
    expect(colorFilterBlockedReason(name, [nameRule, verdictRule], schema, effective)).toBeNull();
    expect(colorFilterBlockedReason(payment, [{ ...verdictRule, enabled: false }], schema)).toBeNull();
    expect(colorFilterBlockedReason(payment, undefined, schema)).toBeNull();
  });

  it("respects the capabilities filter scope", () => {
    const scoped = normalizeCapabilities({ filter: { columnIds: ["payment", "verdict"] } });
    expect(colorFilterBlockedReason(name, [nameRule], schema, scoped)).toBe(
      'a color rule on it uses "Name", which can\'t be filtered on the server',
    );
  });
});

describe("columnOperatorsWithColors with color rules", () => {
  it("drops the color operators for a blocked column only", () => {
    const rules = { rules: [verdictRule], schema };
    expect(columnOperatorsWithColors(payment, registry, effective, rules).map((o) => o.id)).not.toContain("colorIs");
    expect(columnOperatorsWithColors(verdict, registry, effective, rules)).toEqual([]);
    expect(columnOperatorsWithColors(name, registry, effective, rules).map((o) => o.id)).toContain("colorIs");
    // Without the rules input nothing changes.
    expect(columnOperatorsWithColors(payment, registry, effective).map((o) => o.id)).toContain("colorIsNone");
  });
});

describe("column filters", () => {
  it("ConditionFilter hides 'color is' on a blocked column", () => {
    const { unmount } = render(<ConditionFilter {...props(name, [verdictRule])} />);
    expect(screen.getByRole("option", { name: "color is" })).toBeInTheDocument();
    unmount();
    render(<ConditionFilter {...props(name, [{ ...verdictRule, target: { kind: "row" } }])} />);
    expect(screen.queryByRole("option", { name: "color is" })).toBeNull();
    expect(screen.queryByRole("option", { name: "has no color" })).toBeNull();
  });

  it("SetFilter offers no Color mode on a blocked column", () => {
    const { unmount } = render(<SetFilter {...props(payment, [nameRule])} />);
    expect(screen.getByLabelText("Filter by")).toBeInTheDocument();
    unmount();
    render(<SetFilter {...props(payment, [verdictRule])} />);
    expect(screen.queryByLabelText("Filter by")).toBeNull();
  });
});
