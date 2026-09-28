/**
 * v0.4.1: color rules the server can't evaluate. A column a color rule blocks
 * (the rule tests a `filterable: false` column) offers no color operators, and
 * the rules dialog's builder (`allowUnfilterable`) offers unfilterable columns.
 */
import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ColorRule, FilterNode, GridSchema } from "../internal/core-contracts";
import {
  FIXTURE_IDS,
  buildFixtureAccess,
  buildFixtureRegistry,
  buildFixtureSchema,
  buildStubUiRegistry,
} from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { FilterBuilder } from "./FilterBuilder";
import { applicableFilter } from "./liveFilter";
import { filterableColumns, operatorsFor, toDraft, updateCondition } from "./model";

const base = buildFixtureSchema();
/** `notes` is `filterable: false` (e.g. a SQL-view computed column). */
const schema: GridSchema = {
  ...base,
  columns: base.columns.map((c) => (c.id === FIXTURE_IDS.notes ? { ...c, filterable: false } : c)),
};
const registry = buildFixtureRegistry();
const access = buildFixtureAccess(schema);
const COLORS = { cellColors: { read: true, write: true, filter: true } };
const col = (id: string) => {
  const c = schema.columns.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

/** Colors `payment` when `notes` (unfilterable) is not empty. */
const CELLS_RULE: ColorRule = {
  id: "r1",
  color: "red",
  target: { kind: "cells", columnIds: [FIXTURE_IDS.payment] },
  when: { op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isNotEmpty" }] },
};
const ROW_RULE: ColorRule = { ...CELLS_RULE, id: "r2", target: { kind: "row" } };
const REASON = `a color rule on it uses "Notes", which can't be filtered on the server`;

const ids = (ops: readonly { id: string }[]) => ops.map((o) => o.id);

describe("model: color operators blocked by a color rule", () => {
  it("drops color is / has no color on the column a cells rule colors", () => {
    const colorRules = { rules: [CELLS_RULE], schema };
    expect(ids(operatorsFor(col(FIXTURE_IDS.payment), registry, COLORS, { colorRules }))).not.toContain("colorIs");
    expect(ids(operatorsFor(col(FIXTURE_IDS.payment), registry, COLORS, { colorRules }))).toContain("is");
    // A column the rule can't color keeps them.
    expect(ids(operatorsFor(col(FIXTURE_IDS.amount), registry, COLORS, { colorRules }))).toContain("colorIs");
  });

  it("a row rule blocks every column; a disabled rule blocks nothing", () => {
    const colorRules = { rules: [ROW_RULE], schema };
    expect(ids(operatorsFor(col(FIXTURE_IDS.amount), registry, COLORS, { colorRules }))).not.toContain("colorIsNone");
    const off = { rules: [{ ...ROW_RULE, enabled: false }], schema };
    expect(ids(operatorsFor(col(FIXTURE_IDS.amount), registry, COLORS, { colorRules: off }))).toContain("colorIsNone");
  });

  it("a blocked filterable:false column is not offered for color", () => {
    const offered = (rules: ColorRule[]) =>
      filterableColumns(schema, access, COLORS, { colorRules: { rules, schema } }).map((c) => c.id);
    expect(offered([])).toContain(FIXTURE_IDS.notes);
    expect(offered([ROW_RULE])).not.toContain(FIXTURE_IDS.notes);
    expect(offered([ROW_RULE])).toContain(FIXTURE_IDS.payment);
  });
});

describe("model: allowUnfilterable (color rule conditions)", () => {
  it("offers filterable:false columns with their own operators", () => {
    expect(filterableColumns(schema, access).map((c) => c.id)).not.toContain(FIXTURE_IDS.notes);
    expect(filterableColumns(schema, access, undefined, { allowUnfilterable: true }).map((c) => c.id)).toContain(
      FIXTURE_IDS.notes,
    );
    const ops = ids(operatorsFor(col(FIXTURE_IDS.notes), registry, COLORS, { allowUnfilterable: true }));
    expect(ops).toContain("contains");
  });

  it("picking the column starts from its first own operator, and the condition is applicable", () => {
    const ctx = { schema, registry, allowUnfilterable: true };
    const draft = toDraft({ op: "and", children: [] });
    const withRow = { ...draft, children: [{ kind: "condition" as const, id: "c1", columnId: null, operator: null, value: undefined }] };
    const next = updateCondition(withRow, "c1", { columnId: FIXTURE_IDS.notes }, ctx);
    const cond = next.children[0];
    expect(cond?.kind === "condition" && cond.operator).toBe("contains");
    const node: FilterNode = { op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isNotEmpty" }] };
    expect(applicableFilter(node, { schema, registry })).toBeUndefined();
    expect(applicableFilter(node, { schema, registry, allowUnfilterable: true })).toEqual(node);
  });
});

const inputs = (name: string): HTMLInputElement[] =>
  within(document.body)
    .getAllByLabelText(name)
    .filter((e): e is HTMLInputElement => e.tagName === "INPUT");

async function pick(user: UserEvent, field: string, option: string) {
  const el = inputs(field).at(-1);
  if (!el) throw new Error(field);
  await user.click(el);
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("FilterBuilder", () => {
  it("hides the color operators of a blocked column and gives the reason on the operator picker", async () => {
    const { user } = renderWithMantine(
      <FilterBuilder
        debounceMs={0}
        schema={schema}
        registry={registry}
        uiRegistry={buildStubUiRegistry()}
        access={access}
        value={null}
        onChange={vi.fn()}
        capabilities={COLORS}
        colorRules={[CELLS_RULE]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Payment status");
    const op = inputs("Operator").at(-1);
    if (!op) throw new Error("no operator");
    expect(op).toHaveAttribute("aria-description", `Can't filter by color: ${REASON}`);
    await user.click(op);
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toContain("is");
    expect(names).not.toContain("color is");
    expect(names).not.toContain("has no color");
  });

  it("allowUnfilterable: a filterable:false column can be picked and is applied", async () => {
    const onChange = vi.fn<(node: FilterNode | null) => unknown>();
    const { user } = renderWithMantine(
      <FilterBuilder
        debounceMs={0}
        schema={schema}
        registry={registry}
        uiRegistry={buildStubUiRegistry()}
        access={access}
        value={null}
        onChange={onChange}
        allowUnfilterable
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Notes");
    await pick(user, "Operator", "is not empty");
    expect(onChange).toHaveBeenLastCalledWith({
      op: "and",
      children: [{ columnId: FIXTURE_IDS.notes, operator: "isNotEmpty" }],
    });
    expect(screen.queryByText(/cannot be filtered/)).toBeNull();
  });
});
