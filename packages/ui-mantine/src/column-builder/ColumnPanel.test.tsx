import { act, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GridRow } from "../internal/core-contracts";
import {
  FIXTURE_IDS,
  FIXTURE_NOW,
  buildFixtureAccess,
  buildFixtureRegistry,
  buildFixtureSchema,
  buildStubUiRegistry,
  fixtureColumn,
} from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { orderForPosition } from "./ColumnForm";
import { ColumnPanel, type ColumnPanelProps } from "./ColumnPanel";

const NOW = "2026-09-25T12:00:00.000Z";

function setup(overrides: Partial<ColumnPanelProps> = {}) {
  const schema = buildFixtureSchema();
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const r = renderWithMantine(
    <ColumnPanel
      opened
      onClose={onClose}
      schema={schema}
      registry={buildFixtureRegistry()}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      roles={["admin", "counsellor", "viewer"]}
      onSave={onSave}
      onDelete={onDelete}
      now={() => NOW}
      generateId={() => "col_generated"}
      {...overrides}
    />,
  );
  return { ...r, onSave, onDelete, onClose };
}

const nameInput = () => screen.getByRole("textbox", { name: "Name" });
const createButton = () => screen.getByRole("button", { name: "Create column" });

async function pickType(user: ReturnType<typeof setup>["user"], label: string) {
  await user.click(screen.getByRole("button", { name: /^Type:/ }));
  await user.click(await screen.findByRole("option", { name: label }));
}

const row = (id: string, cells: Record<string, unknown>): GridRow => ({ id, version: 1, updatedAt: FIXTURE_NOW, cells });

describe("ColumnPanel", () => {
  it("is a dialog named 'New column' with the Name field focused-ready and Text as the default type", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "New column" })).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute("data-autofocus");
    expect(screen.getByRole("button", { name: "Type: Text" })).toBeInTheDocument();
  });

  it("creates a select column with three options", async () => {
    const { user, onSave } = setup();
    await user.type(nameInput(), "Payment Status");
    await pickType(user, "Select");
    for (const [i, label] of ["Paid", "Pending", "Failed"].entries()) {
      await user.click(screen.getByRole("button", { name: "Add option" }));
      await user.type(screen.getAllByRole("textbox", { name: "Option label" })[i] as HTMLElement, label);
    }
    await user.click(createButton());
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0];
    expect(saved).toMatchObject({
      id: "col_generated",
      key: "payment_status_2",
      label: "Payment Status",
      type: "select",
      permissions: { read: "all", edit: "all" },
      createdAt: NOW,
    });
    expect(saved.config.options).toEqual([
      { id: "paid", label: "Paid" },
      { id: "pending", label: "Pending" },
      { id: "failed", label: "Failed" },
    ]);
  });

  it("derives the key from the name until the key is edited", async () => {
    const { user, onSave } = setup();
    await user.type(nameInput(), "Lead Source");
    expect(screen.getByTestId("column-key")).toHaveTextContent("lead_source");
    await user.click(screen.getByRole("button", { name: "Edit key" }));
    const key = screen.getByRole("textbox", { name: /^Key/ });
    await user.clear(key);
    await user.type(key, "src");
    await user.type(nameInput(), "s");
    expect(key).toHaveValue("src");
    await user.click(createButton());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ key: "src", label: "Lead Sources", type: "text" });
  });

  it("shows no error on first paint or on passing through; the name error appears after leaving it emptied", async () => {
    const { user } = setup();
    expect(screen.queryByText("Give the column a name")).not.toBeInTheDocument();
    expect(nameInput()).not.toHaveAttribute("aria-invalid", "true");
    await user.click(nameInput());
    await user.tab();
    expect(screen.queryByText("Give the column a name")).not.toBeInTheDocument();
    await user.type(nameInput(), "Tmp");
    await user.clear(nameInput());
    expect(screen.queryByText("Give the column a name")).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByText("Give the column a name")).toBeInTheDocument();
    await user.type(nameInput(), "X");
    expect(screen.queryByText("Give the column a name")).not.toBeInTheDocument();
  });

  it("keeps Create disabled while something is missing", async () => {
    const { user, onSave } = setup();
    expect(createButton()).toBeDisabled();
    await user.type(nameInput(), "Notes 2");
    expect(createButton()).toBeEnabled();
    await user.click(createButton());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("type options show a label and a human description, never the raw type id", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /^Type:/ }));
    const option = await screen.findByRole("option", { name: "Creatable select" });
    expect(option).toHaveTextContent("users can add new ones");
    const list = screen.getByRole("listbox", { name: "Field types" });
    expect(within(list).queryByText("creatableSelect")).not.toBeInTheDocument();
    expect(within(list).queryByText("multiSelect")).not.toBeInTheDocument();
  });

  it("formula: invalid formulas block Create; valid ones save with the inferred result type", async () => {
    const { user, onSave } = setup();
    await user.type(nameInput(), "Double");
    await pickType(user, "Formula");
    const formula = screen.getByRole("textbox", { name: /Formula/ });
    await user.type(formula, "{{amount} *");
    expect(createButton()).toBeDisabled();
    await user.type(formula, " 2");
    expect(createButton()).toBeEnabled();
    await user.click(createButton());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ type: "formula", formula: "{amount} * 2", required: false, config: { resultType: "number" } });
  });

  it("formula: live preview evaluates the first three sample rows", async () => {
    const sampleRows = [row("r1", { amount: 100 }), row("r2", { amount: 250 }), row("r3", { amount: 1 }), row("r4", { amount: 9 })];
    const { user } = setup({ sampleRows });
    await user.type(nameInput(), "Double");
    await pickType(user, "Formula");
    await user.type(screen.getByRole("textbox", { name: /Formula/ }), "{{amount} * 2");
    const preview = screen.getByTestId("formula-preview");
    expect(within(preview).getByText("200")).toBeInTheDocument();
    expect(within(preview).getByText("500")).toBeInTheDocument();
    expect(within(preview).getByText("2")).toBeInTheDocument();
    expect(within(preview).queryByText("18")).not.toBeInTheDocument();
  });

  it("formula: column chips insert a reference and examples come from this table's columns", async () => {
    const { user } = setup();
    await pickType(user, "Formula");
    await user.click(screen.getByRole("button", { name: "Insert Amount" }));
    expect(screen.getByRole("textbox", { name: /Formula/ })).toHaveValue("{amount}");
    const example = screen.getByRole("button", { name: /Use example: Flag when Payment status is Paid/ });
    await user.click(example);
    expect(screen.getByRole("textbox", { name: /Formula/ })).toHaveValue('IF({payment_status} = "Paid", "✓", "")');
  });

  it("edit mode: title names the column, the type is locked, the key is locked, Save keeps the id", async () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const { user, onSave } = setup({ column });
    expect(screen.getByRole("dialog", { name: "Edit column · Payment status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Type: Select" })).toBeDisabled();
    expect(screen.getByText("The type can't be changed after the column is created.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit key" })).not.toBeInTheDocument();
    await user.clear(nameInput());
    await user.type(nameInput(), "Payment");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ id: FIXTURE_IDS.payment, key: "payment_status", label: "Payment", type: "select" });
  });

  it("delete asks for confirmation", async () => {
    const { user, onDelete } = setup({ column: fixtureColumn(FIXTURE_IDS.payment) });
    await user.click(screen.getByRole("button", { name: "Delete column" }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Confirm delete" }));
    expect(onDelete).toHaveBeenCalledWith(FIXTURE_IDS.payment);
  });

  it("closing with unsaved changes asks first; a clean panel closes at once", async () => {
    const clean = setup();
    await clean.user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(clean.onClose).toHaveBeenCalledTimes(1);
    clean.unmount();

    const { user, onClose } = setup();
    await user.type(nameInput(), "Draft");
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog", { name: "Discard changes?" });
    await user.click(within(confirm).getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("inserts at a position: order between the neighbours, position passed to onSave", async () => {
    const position = { afterColumnId: FIXTURE_IDS.payment };
    const { user, onSave } = setup({ position });
    await user.type(nameInput(), "Next to payment");
    await user.click(createButton());
    const [saved, pos] = onSave.mock.calls[0] ?? [];
    expect(saved.order).toBe(0.5);
    expect(pos).toEqual(position);
  });

  it("reports the draft column (debounced) for a live ghost column, and null on close", async () => {
    vi.useFakeTimers();
    try {
      const onDraftChange = vi.fn();
      const schema = buildFixtureSchema();
      const r = renderWithMantine(
        <ColumnPanel
          opened
          onClose={() => {}}
          schema={schema}
          registry={buildFixtureRegistry()}
          uiRegistry={buildStubUiRegistry()}
          access={buildFixtureAccess(schema)}
          roles={[]}
          onSave={() => {}}
          onDraftChange={onDraftChange}
        />,
      );
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: "text", label: "Untitled" }));
      r.unmount();
      expect(onDraftChange).toHaveBeenLastCalledWith(null);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("orderForPosition", () => {
  const schema = buildFixtureSchema();
  it("places before, after and at an index", () => {
    expect(orderForPosition(schema, { beforeColumnId: FIXTURE_IDS.payment })).toBe(-1);
    expect(orderForPosition(schema, { afterColumnId: FIXTURE_IDS.total })).toBe(8);
    expect(orderForPosition(schema, 2)).toBe(1.5);
    expect(orderForPosition(schema, undefined)).toBeUndefined();
  });
});
