/** v0.4.1: rule conditions may test `filterable: false` columns; such a rule can't be used to filter by color. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColorRule, GridSchema } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry } from "../test/fixtures";
import { renderUi } from "../test/render";
import { ColorRulesDialog } from "./ColorRulesDialog";

const base = buildFixtureSchema();
/** Notes is `filterable: false` (e.g. a SQL-view computed column). */
const schema: GridSchema = {
  ...base,
  columns: base.columns.map((c) => (c.id === FIXTURE_IDS.notes ? { ...c, filterable: false } : c)),
};

const ON_NOTES: ColorRule = {
  id: "notes",
  color: "red",
  target: { kind: "row" },
  when: { op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }] },
};
const ON_PAYMENT: ColorRule = {
  id: "paid",
  color: "green",
  target: { kind: "row" },
  when: { op: "and", children: [{ columnId: FIXTURE_IDS.payment, operator: "is", value: "paid" }] },
};

const NOTE = "Can't be used to filter by color";

function setup(rules: ColorRule[], capabilities?: Parameters<typeof ColorRulesDialog>[0]["capabilities"]) {
  const onSave = vi.fn<(rules: ColorRule[]) => void>();
  const r = renderUi(
    <ColorRulesDialog
      opened
      onClose={vi.fn()}
      schema={schema}
      registry={buildFixtureRegistry()}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      rules={rules}
      onSave={onSave}
      {...(capabilities ? { capabilities } : {})}
    />,
  );
  return { ...r, onSave };
}

const ruleGroup = (n: number) => screen.getByRole("group", { name: `Rule ${n}` });

describe("ColorRulesDialog: unfilterable columns (v0.4.1)", () => {
  it("shows a rule on a filterable:false column with a subtle note, and saves it", async () => {
    const { user, onSave } = setup([ON_NOTES, ON_PAYMENT]);
    expect(within(ruleGroup(1)).getByRole("combobox", { name: "Column" })).toHaveTextContent("Notes");
    expect(within(ruleGroup(1)).getByText(NOTE)).toBeInTheDocument();
    expect(within(ruleGroup(2)).queryByText(NOTE)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save rules" }));
    expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ id: "notes", when: ON_NOTES.when }), expect.objectContaining({ id: "paid" })]);
  });

  it("offers filterable:false columns in a rule's condition", async () => {
    const { user } = setup([ON_PAYMENT]);
    await user.click(within(ruleGroup(1)).getByRole("combobox", { name: "Column" }));
    expect(await screen.findByRole("option", { name: "Notes" })).toBeInTheDocument();
  });

  it("the note follows the source's filter scope (capabilities)", () => {
    setup([ON_PAYMENT], { filter: { columnIds: [FIXTURE_IDS.amount] } });
    expect(within(ruleGroup(1)).getByText(NOTE)).toBeInTheDocument();
  });
});
