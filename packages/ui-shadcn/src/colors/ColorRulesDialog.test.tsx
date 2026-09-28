import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColorRule } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry } from "../test/fixtures";
import { renderUi } from "../test/render";
import { ColorRulesDialog } from "./ColorRulesDialog";

const schema = buildFixtureSchema();
const PAID: ColorRule = {
  id: "paid",
  color: "green",
  target: { kind: "row" },
  when: { op: "and", children: [{ columnId: FIXTURE_IDS.payment, operator: "is", value: "paid" }] },
};
const BIG: ColorRule = {
  id: "big",
  color: "orange",
  target: { kind: "cells", columnIds: [FIXTURE_IDS.amount] },
  when: { op: "and", children: [{ columnId: FIXTURE_IDS.amount, operator: "gt", value: 1000 }] },
  enabled: true,
};

function setup(rules: ColorRule[] = [PAID, BIG]) {
  const onSave = vi.fn<(rules: ColorRule[]) => void>();
  const onClose = vi.fn();
  const r = renderUi(
    <ColorRulesDialog
      opened
      onClose={onClose}
      schema={schema}
      registry={buildFixtureRegistry()}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      rules={rules}
      onSave={onSave}
    />,
  );
  return { ...r, onSave, onClose, dialog: screen.getByRole("dialog", { name: "Color rules" }) };
}

const ruleGroup = (n: number) => screen.getByRole("group", { name: `Rule ${n}` });

describe("ColorRulesDialog", () => {
  it("lists the view's rules with color, target, condition and enabled state", () => {
    setup();
    const first = ruleGroup(1);
    expect(within(first).getByRole("button", { name: "Color: Green" })).toBeInTheDocument();
    expect(within(first).getByRole("radio", { name: "Whole row" })).toHaveAttribute("aria-checked", "true");
    expect(within(first).getByRole("switch", { name: "Enabled" })).toBeChecked();
    // The condition is the kit's filter builder.
    expect(within(first).getByRole("combobox", { name: "Column" })).toHaveTextContent("Payment status");
    const second = ruleGroup(2);
    expect(within(second).getByRole("radio", { name: "Columns" })).toHaveAttribute("aria-checked", "true");
    expect(within(second).getByRole("combobox", { name: "Target columns" })).toHaveTextContent("Amount");
  });

  it("shows an empty state and adds a rule", async () => {
    const { user, onSave } = setup([]);
    expect(screen.getByText(/No color rules yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add rule" }));
    const rule = ruleGroup(1);
    await user.click(within(rule).getByRole("button", { name: /^Color:/ }));
    await user.click(await screen.findByRole("button", { name: "Teal" }));
    expect(within(rule).getByRole("button", { name: "Color: Teal" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save rules" }));
    expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ color: "teal", target: { kind: "row" }, when: null, enabled: true })]);
  });

  it("reorders, toggles and deletes, then saves in the new order", async () => {
    const { user, onSave, onClose } = setup();
    await user.click(within(ruleGroup(2)).getByRole("button", { name: "Move rule 2 up" }));
    expect(within(ruleGroup(1)).getByRole("button", { name: "Color: Orange" })).toBeInTheDocument();
    expect(within(ruleGroup(1)).getByRole("button", { name: "Move rule 1 up" })).toBeDisabled();
    await user.click(within(ruleGroup(2)).getByRole("switch", { name: "Enabled" }));
    await user.click(screen.getByRole("button", { name: "Save rules" }));
    expect(onSave).toHaveBeenCalledWith([BIG, { ...PAID, enabled: false }]);
    expect(onClose).toHaveBeenCalled();
    onSave.mockClear();
    await user.click(within(ruleGroup(1)).getByRole("button", { name: "Delete rule 1" }));
    await user.click(screen.getByRole("button", { name: "Save rules" }));
    expect(onSave).toHaveBeenCalledWith([{ ...PAID, enabled: false }]);
  });

  it("switches a rule to target columns", async () => {
    const { user, onSave } = setup([PAID]);
    await user.click(within(ruleGroup(1)).getByRole("radio", { name: "Columns" }));
    await user.click(within(ruleGroup(1)).getByRole("combobox", { name: "Target columns" }));
    const list = await screen.findByRole("listbox");
    // Hidden columns are never offered.
    expect(within(list).queryByRole("option", { name: "Secret" })).toBeNull();
    await user.click(within(list).getByRole("option", { name: "Notes" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Save rules" }));
    expect(onSave).toHaveBeenCalledWith([{ ...PAID, target: { kind: "cells", columnIds: [FIXTURE_IDS.notes] } }]);
  });

  it("validates before saving and shows issues on the rule", async () => {
    const { user, onSave } = setup([PAID]);
    await user.click(within(ruleGroup(1)).getByRole("radio", { name: "Columns" }));
    await user.click(screen.getByRole("button", { name: "Save rules" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(within(ruleGroup(1)).getByRole("alert")).toHaveTextContent("A cells rule needs at least one column");
    expect(screen.getByText("Fix 1 problem to save")).toBeInTheDocument();
  });

  it("Cancel discards the draft", async () => {
    const { user, onSave, onClose } = setup();
    await user.click(within(ruleGroup(1)).getByRole("button", { name: "Delete rule 1" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
