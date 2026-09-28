/**
 * v0.4.1: color rules the server can't evaluate block filtering by color, and
 * the rules dialog's builder accepts unfilterable columns (`allowUnfilterable`).
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColorRule, FilterNode, GridSchema } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry } from "../test/fixtures";
import { renderUi } from "../test/render";
import { FilterBuilder } from "./FilterBuilder";
import { colorBlockedReason, filterableColumns, operatorsFor } from "./model";

const COLORS_ON = { cellColors: { read: true, write: true, filter: true } };

const base = buildFixtureSchema();
/** Notes is `filterable: false` (e.g. a SQL-view computed column). */
const schema: GridSchema = {
  ...base,
  columns: base.columns.map((c) => (c.id === FIXTURE_IDS.notes ? { ...c, filterable: false } : c)),
};
const registry = buildFixtureRegistry();
const access = buildFixtureAccess(schema);
const col = (id: string) => {
  const c = schema.columns.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const ids = (ops: readonly { id: string }[]) => ops.map((o) => o.id);

/** Colors Payment status (and Notes) when Notes is empty: Notes can't be filtered on the server. */
const blockingRule: ColorRule = {
  id: "r1",
  color: "red",
  target: { kind: "cells", columnIds: [FIXTURE_IDS.payment, FIXTURE_IDS.notes] },
  when: { columnId: FIXTURE_IDS.notes, operator: "isEmpty" },
};
const REASON = `a color rule on it uses "Notes", which can't be filtered on the server`;

const colorRules = { rules: [blockingRule], schema };

describe("colorBlockedReason (model)", () => {
  it("names the reason for each column a rule blocks, only while colors filter", () => {
    expect(colorBlockedReason(col(FIXTURE_IDS.payment), COLORS_ON, colorRules)).toBe(REASON);
    expect(colorBlockedReason(col(FIXTURE_IDS.notes), COLORS_ON, colorRules)).toBe(REASON);
    expect(colorBlockedReason(col(FIXTURE_IDS.amount), COLORS_ON, colorRules)).toBeNull();
    expect(colorBlockedReason(col(FIXTURE_IDS.payment), undefined, colorRules)).toBeNull();
    expect(colorBlockedReason(col(FIXTURE_IDS.payment), COLORS_ON, undefined)).toBeNull();
  });

  it("counts columns outside the capabilities' filter scope as unfilterable", () => {
    const onAmount = { ...blockingRule, when: { columnId: FIXTURE_IDS.amount, operator: "isEmpty" } };
    const scoped = { ...COLORS_ON, filter: { columnIds: [FIXTURE_IDS.payment] } };
    expect(colorBlockedReason(col(FIXTURE_IDS.payment), COLORS_ON, { rules: [onAmount], schema })).toBeNull();
    expect(colorBlockedReason(col(FIXTURE_IDS.payment), scoped, { rules: [onAmount], schema })).toContain('"Amount"');
  });

  it("drops the color operators of a blocked column, and a blocked filterable:false column from the picker", () => {
    expect(ids(operatorsFor(col(FIXTURE_IDS.payment), registry, COLORS_ON, { colorRules }))).not.toContain("colorIs");
    expect(ids(operatorsFor(col(FIXTURE_IDS.amount), registry, COLORS_ON, { colorRules }))).toContain("colorIs");
    expect(operatorsFor(col(FIXTURE_IDS.notes), registry, COLORS_ON, { colorRules })).toEqual([]);
    const picked = filterableColumns(schema, access, COLORS_ON, { colorRules }).map((c) => c.id);
    expect(picked).not.toContain(FIXTURE_IDS.notes);
    expect(picked).toContain(FIXTURE_IDS.payment);
  });

  it("allowUnfilterable: filterable:false columns are pickable with their own operators (no colors)", () => {
    const picked = filterableColumns(schema, access, undefined, { allowUnfilterable: true }).map((c) => c.id);
    expect(picked).toContain(FIXTURE_IDS.notes);
    expect(ids(operatorsFor(col(FIXTURE_IDS.notes), registry))).toContain("isEmpty");
  });
});

function setup(extra: Partial<Parameters<typeof FilterBuilder>[0]> = {}, value: FilterNode | null = null) {
  const onChange = vi.fn<(node: FilterNode | null) => void>();
  const r = renderUi(
    <FilterBuilder
      schema={schema}
      registry={registry}
      uiRegistry={buildStubUiRegistry()}
      access={access}
      value={value ?? { op: "and", children: [{ columnId: FIXTURE_IDS.payment, operator: "isEmpty" }] }}
      onChange={onChange}
      debounceMs={0}
      {...extra}
    />,
  );
  return { ...r, onChange };
}

describe("FilterBuilder colorRules (blocked color filters)", () => {
  it("leaves out `color is` for a blocked column and says why in the operator list", async () => {
    const { user } = setup({ capabilities: COLORS_ON, colorRules: [blockingRule] });
    await user.click(screen.getByRole("combobox", { name: "Operator" }));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).not.toContain("color is");
    expect(names).not.toContain("has no color");
    expect(screen.getByText(`Can't filter by color: ${REASON}`)).toBeInTheDocument();
  });

  it("keeps the color operators when no rule blocks the column", async () => {
    const { user } = setup({ capabilities: COLORS_ON, colorRules: [{ ...blockingRule, enabled: false }] });
    await user.click(screen.getByRole("combobox", { name: "Operator" }));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toContain("color is");
    expect(screen.queryByText(/Can't filter by color/)).toBeNull();
  });
});

describe("FilterBuilder allowUnfilterable", () => {
  it("offers a filterable:false column and applies a condition on it", async () => {
    const { user, onChange } = setup({ allowUnfilterable: true }, { op: "and", children: [{ columnId: FIXTURE_IDS.payment, operator: "isEmpty" }] });
    await user.click(screen.getByRole("combobox", { name: "Column" }));
    await user.click(await screen.findByRole("option", { name: "Notes" }));
    await user.click(screen.getByRole("combobox", { name: "Operator" }));
    await user.click(await screen.findByRole("option", { name: "is empty" }));
    expect(onChange).toHaveBeenLastCalledWith({
      op: "and",
      children: [{ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }],
    });
    expect(screen.queryByText(/cannot be filtered/i)).toBeNull();
  });

  it("without it, the column isn't offered", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("combobox", { name: "Column" }));
    await screen.findAllByRole("option");
    expect(screen.queryByRole("option", { name: "Notes" })).toBeNull();
  });
});
