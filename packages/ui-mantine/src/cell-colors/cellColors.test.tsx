import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ColorRule } from "../internal/core-contracts";
import {
  FIXTURE_IDS,
  buildFixtureAccess,
  buildFixtureRegistry,
  buildFixtureSchema,
  buildStubUiRegistry,
} from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { CellColorButton } from "./CellColorButton";
import { CellColorPicker } from "./CellColorPicker";
import {
  ColorRulesDialog,
  type ColorRulesDialogProps,
} from "./ColorRulesDialog";
import { ColorSwatchMultiSelect } from "./ColorSwatchMultiSelect";

const schema = buildFixtureSchema();

describe("<CellColorPicker>", () => {
  it("one button per palette color plus No color", async () => {
    const onPick = vi.fn();
    const { user } = renderWithMantine(<CellColorPicker onPick={onPick} />);
    const group = screen.getByRole("group", { name: "Cell colors" });
    expect(within(group).getAllByRole("button")).toHaveLength(10);
    await user.click(within(group).getByRole("button", { name: "Purple" }));
    expect(onPick).toHaveBeenLastCalledWith("purple");
    await user.click(within(group).getByRole("button", { name: "No color" }));
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it("withNone={false} hides No color; disabled disables every swatch", () => {
    renderWithMantine(
      <CellColorPicker onPick={() => undefined} withNone={false} disabled />,
    );
    const buttons = within(
      screen.getByRole("group", { name: "Cell colors" }),
    ).getAllByRole("button");
    expect(buttons).toHaveLength(9);
    for (const b of buttons) expect(b).toBeDisabled();
  });
});

describe("<ColorSwatchMultiSelect>", () => {
  it("toggles colors in palette order", async () => {
    const onChange = vi.fn();
    const { user, rerender } = renderWithMantine(
      <ColorSwatchMultiSelect value={["blue"]} onChange={onChange} />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Red" }));
    expect(onChange).toHaveBeenLastCalledWith(["red", "blue"]);
    rerender(
      <ColorSwatchMultiSelect value={["red", "blue"]} onChange={onChange} />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Blue" }));
    expect(onChange).toHaveBeenLastCalledWith(["red"]);
  });
});

describe("<CellColorButton>", () => {
  it("opens the palette and paints; closes after a pick", async () => {
    const onPaint = vi.fn();
    const { user } = renderWithMantine(
      <CellColorButton canPaint onPaint={onPaint} />,
    );
    await user.click(screen.getByRole("button", { name: "Cell color" }));
    await user.click(await screen.findByRole("button", { name: "Green" }));
    expect(onPaint).toHaveBeenCalledWith("green");
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Cell colors" })).toBeNull(),
    );
  });

  it("explains why the swatches are disabled when nothing paintable is selected", async () => {
    const onPaint = vi.fn();
    const { user } = renderWithMantine(
      <CellColorButton canPaint={false} onPaint={onPaint} />,
    );
    await user.click(screen.getByRole("button", { name: "Cell color" }));
    expect(
      await screen.findByText("Select cells you can edit to color them."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Red" })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Rules dialog
// ---------------------------------------------------------------------------

const inputs = (
  name: string,
  root: HTMLElement = document.body,
): HTMLInputElement[] =>
  within(root)
    .getAllByLabelText(name)
    .filter((e): e is HTMLInputElement => e.tagName === "INPUT");

async function pick(
  user: UserEvent,
  root: HTMLElement,
  field: string,
  option: string,
) {
  const el = inputs(field, root).at(-1);
  if (!el) throw new Error(field);
  await user.click(el);
  await user.click(await within(root).findByRole("option", { name: option }));
}

const RULES: ColorRule[] = [
  {
    id: "r1",
    color: "red",
    target: { kind: "row" },
    when: { columnId: FIXTURE_IDS.payment, operator: "is", value: "failed" },
  },
  {
    id: "r2",
    color: "green",
    target: { kind: "cells", columnIds: [FIXTURE_IDS.amount] },
    when: { columnId: FIXTURE_IDS.payment, operator: "is", value: "paid" },
    enabled: false,
  },
];

function renderDialog(extra: Partial<ColorRulesDialogProps> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const r = renderWithMantine(
    <ColorRulesDialog
      opened
      onClose={onClose}
      schema={schema}
      registry={buildFixtureRegistry()}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      rules={RULES}
      onSave={onSave}
      {...extra}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "Color rules" });
  const rule = (n: number) =>
    within(dialog).getByRole("group", { name: `Rule ${n}` });
  return { ...r, onSave, onClose, dialog, rule };
}

describe("<ColorRulesDialog>", () => {
  it("lists the rules with color, target, condition and enabled state", () => {
    const { rule } = renderDialog();
    expect(within(rule(1)).getByRole("radio", { name: "Red" })).toBeChecked();
    expect(
      within(rule(1)).getByRole("radio", { name: "Whole row" }),
    ).toBeChecked();
    expect(inputs("Column", rule(1)).map((i) => i.value)).toEqual([
      "Payment status",
    ]);
    expect(
      within(rule(1)).getByRole("switch", { name: "Enabled" }),
    ).toBeChecked();
    expect(
      within(rule(2)).getByRole("radio", { name: "Columns" }),
    ).toBeChecked();
    expect(
      within(rule(2)).getByRole("switch", { name: "Enabled" }),
    ).not.toBeChecked();
  });

  it("Save hands back the edited, validated rules (reorder, toggle, recolor, delete)", async () => {
    const { user, rule, onSave, onClose, dialog } = renderDialog();
    await user.click(within(rule(2)).getByRole("button", { name: "Move up" }));
    // r2 is now first.
    await user.click(within(rule(1)).getByRole("switch", { name: "Enabled" }));
    await user.click(within(rule(1)).getByRole("radio", { name: "Blue" }));
    await user.click(
      within(rule(2)).getByRole("button", { name: "Delete rule" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith([
      {
        id: "r2",
        color: "blue",
        target: { kind: "cells", columnIds: [FIXTURE_IDS.amount] },
        when: { columnId: FIXTURE_IDS.payment, operator: "is", value: "paid" },
        enabled: true,
      },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("adds a rule and builds its condition with the filter builder", async () => {
    const { user, rule, onSave, dialog } = renderDialog({ rules: [] });
    expect(within(dialog).getByText(/No color rules yet/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add rule" }));
    const r = rule(1);
    await user.click(within(r).getByRole("button", { name: "Add condition" }));
    await pick(user, r, "Column", "Payment status");
    await pick(user, r, "Operator", "is");
    await pick(user, r, "Value", "Pending");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    const saved = onSave.mock.lastCall?.[0] as ColorRule[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      color: "yellow",
      target: { kind: "row" },
      when: {
        op: "and",
        children: [
          { columnId: FIXTURE_IDS.payment, operator: "is", value: "pending" },
        ],
      },
    });
    expect(saved[0]?.id).toMatch(/^rule_/);
  });

  it("shows validation issues inline and does not save", async () => {
    const { user, rule, onSave, dialog } = renderDialog({ rules: [] });
    await user.click(within(dialog).getByRole("button", { name: "Add rule" }));
    await user.click(within(rule(1)).getByRole("radio", { name: "Columns" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(
      within(rule(1)).getByText("A cells rule needs at least one column"),
    ).toBeInTheDocument();
    await pick(user, rule(1), "Columns", "Amount");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({
        target: { kind: "cells", columnIds: [FIXTURE_IDS.amount] },
      }),
    ]);
  });

  it("never offers hidden columns as targets", async () => {
    const { user, rule, dialog } = renderDialog({ rules: [] });
    await user.click(within(dialog).getByRole("button", { name: "Add rule" }));
    await user.click(within(rule(1)).getByRole("radio", { name: "Columns" }));
    const box = inputs("Columns", rule(1)).at(-1);
    if (!box) throw new Error("no columns picker");
    await user.click(box);
    const names = within(rule(1))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toContain("Amount");
    expect(names).not.toContain("Secret");
  });

  it("Cancel discards edits", async () => {
    const { user, rule, onSave, onClose, dialog } = renderDialog();
    await user.click(
      within(rule(1)).getByRole("button", { name: "Delete rule" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
