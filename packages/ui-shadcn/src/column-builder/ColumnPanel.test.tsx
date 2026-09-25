import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GridRow } from "../internal/core-contracts";
import {
  FIXTURE_IDS,
  buildFixtureAccess,
  buildFixtureRegistry,
  buildFixtureSchema,
  buildStubUiRegistry,
  fixtureColumn,
} from "../test/fixtures";
import { renderUi } from "../test/render";
import { ColumnPanel, type ColumnPanelProps } from "./ColumnPanel";

const NOW = "2026-09-25T12:00:00.000Z";

function baseProps(overrides: Partial<ColumnPanelProps> = {}): ColumnPanelProps {
  const schema = overrides.schema ?? buildFixtureSchema();
  return {
    opened: true,
    onClose: vi.fn(),
    schema,
    registry: buildFixtureRegistry(),
    uiRegistry: buildStubUiRegistry(),
    access: buildFixtureAccess(schema),
    roles: ["admin", "counsellor"],
    onSave: vi.fn(),
    onDelete: vi.fn(),
    now: () => NOW,
    generateId: () => "col_generated",
    ...overrides,
  };
}

function setup(overrides: Partial<ColumnPanelProps> = {}) {
  const props = baseProps(overrides);
  const r = renderUi(<ColumnPanel {...props} />);
  return { ...r, props, onSave: props.onSave as ReturnType<typeof vi.fn>, onDelete: props.onDelete as ReturnType<typeof vi.fn>, onClose: props.onClose as ReturnType<typeof vi.fn> };
}

const name = () => screen.getByRole("textbox", { name: /^Name/ });
const primary = (label = "Create column") => screen.getByRole("button", { name: label });
const typeTrigger = () => screen.getByRole("button", { name: /^Type/ });

async function pickType(user: ReturnType<typeof renderUi>["user"], label: RegExp) {
  await user.click(typeTrigger());
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("ColumnPanel", () => {
  it("is a non-modal side panel named by its title, with the name focused", () => {
    setup();
    const panel = screen.getByRole("dialog", { name: "New column" });
    expect(panel).toHaveClass("sg-ui");
    expect(name()).toHaveFocus();
    expect(document.querySelector("[data-slot=dialog-overlay]")).toBeNull();
  });

  it("creates a select column end to end", async () => {
    const { user, onSave } = setup();
    await user.type(name(), "Payment Status");
    expect(screen.getByTestId("column-key")).toHaveTextContent("payment_status_2");
    await pickType(user, /^Select/);
    expect(typeTrigger()).toHaveTextContent("Select");
    for (const [i, label] of ["Paid", "Pending", "Failed"].entries()) {
      await user.click(screen.getByRole("button", { name: "Add option" }));
      await user.type(screen.getAllByRole("textbox", { name: "Option label" })[i] as HTMLElement, label);
    }
    await user.click(within(screen.getAllByRole("radiogroup", { name: "Option colour" })[0] as HTMLElement).getByRole("radio", { name: "green" }));
    await user.click(primary());
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0];
    expect(saved).toMatchObject({
      id: "col_generated",
      key: "payment_status_2",
      label: "Payment Status",
      type: "select",
      permissions: { read: "all", edit: "all" },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(saved.config.options).toEqual([
      { id: "paid", label: "Paid", color: "green" },
      { id: "pending", label: "Pending" },
      { id: "failed", label: "Failed" },
    ]);
  });

  it("uses the plain slug when the key is free", async () => {
    const schema = buildFixtureSchema();
    schema.columns = schema.columns.filter((c) => c.key !== "payment_status");
    const { user, onSave } = setup({ schema, access: buildFixtureAccess(schema) });
    await user.type(name(), "Payment Status");
    await pickType(user, /^Text/);
    await user.click(primary());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ key: "payment_status", type: "text" });
  });

  it("shows validation errors only after blur", async () => {
    const { user } = setup();
    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    await user.type(name(), "X");
    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
  });

  it("keeps the primary action disabled while invalid and lists what's missing", async () => {
    const { user, onSave } = setup();
    expect(primary()).toHaveAttribute("aria-disabled", "true");
    expect(primary()).toHaveAccessibleDescription("Missing: Name is required · Choose a type");
    await user.hover(primary());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Name is required · Choose a type");
    await user.click(primary());
    expect(onSave).not.toHaveBeenCalled();
    // A submit attempt reveals the inline errors.
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("Choose a type")).toBeInTheDocument();
    await user.type(name(), "Status");
    await pickType(user, /^Select/);
    expect(primary()).toHaveAccessibleDescription("Missing: Add at least one option");
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.type(screen.getByRole("textbox", { name: "Option label" }), "Open");
    expect(primary()).not.toHaveAttribute("aria-disabled");
  });

  it("formula type shows the formula editor; invalid formulas block saving", async () => {
    const rows: GridRow[] = [{ id: "r1", version: 1, updatedAt: NOW, cells: { amount: 21 } }];
    const { user, onSave } = setup({ sampleRows: rows });
    await user.type(name(), "Double");
    await pickType(user, /^Formula/);
    const formula = screen.getByRole("textbox", { name: /Formula/ });
    await user.type(formula, "{{amount} *");
    await user.click(primary());
    expect(onSave).not.toHaveBeenCalled();
    expect(primary()).toHaveAccessibleDescription("Missing: Fix the formula");
    await user.type(formula, " 2");
    expect(within(screen.getByRole("table", { name: "Formula preview" })).getByText("42")).toBeInTheDocument();
    await user.click(primary());
    await user.click(primary());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ type: "formula", formula: "{amount} * 2", required: false, config: { resultType: "number" } });
  });

  it("number columns show a live format preview", async () => {
    const { user } = setup();
    await pickType(user, /^Number/);
    expect(screen.getByLabelText("Format preview")).toHaveTextContent("12,34,568");
    const precision = screen.getByRole("textbox", { name: "Precision" });
    await user.clear(precision);
    await user.type(precision, "2");
    expect(screen.getByLabelText("Format preview")).toHaveTextContent("12,34,567.89");
  });

  it("edit mode locks the type and key and keeps the id", async () => {
    const { user, onSave } = setup({ column: fixtureColumn(FIXTURE_IDS.payment) });
    expect(screen.getByRole("dialog", { name: "Edit column" })).toBeInTheDocument();
    expect(typeTrigger()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Edit key" })).not.toBeInTheDocument();
    await user.clear(name());
    await user.type(name(), "Payment");
    await user.click(primary("Save"));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ id: FIXTURE_IDS.payment, key: "payment_status", label: "Payment", type: "select" });
  });

  it("delete asks for confirmation", async () => {
    const { user, onDelete } = setup({ column: fixtureColumn(FIXTURE_IDS.payment) });
    await user.click(screen.getByRole("button", { name: "Delete column" }));
    expect(onDelete).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog", { name: "Delete this column?" });
    await user.click(within(confirm).getByRole("button", { name: "Confirm delete" }));
    expect(onDelete).toHaveBeenCalledWith(FIXTURE_IDS.payment);
  });

  it("Esc closes a clean panel straight away", async () => {
    const { user, onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc with a dirty draft asks to discard first", async () => {
    const { user, onClose } = setup();
    await user.type(name(), "Draft");
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog", { name: "Discard changes?" });
    expect(within(confirm).getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(name()).toHaveValue("Draft");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking outside (the grid) does not close the panel", async () => {
    const outside = document.createElement("button");
    outside.textContent = "grid cell";
    document.body.appendChild(outside);
    const { user, onClose } = setup();
    await user.click(outside);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "New column" })).toBeInTheDocument();
    outside.remove();
  });

  it("fires onDraftChange (debounced) with the draft column, and null on close", async () => {
    const onDraftChange = vi.fn();
    const props = baseProps({ onDraftChange, insertAt: 2 });
    const { user, rerender } = renderUi(<ColumnPanel {...props} />);
    await user.type(name(), "Lead score");
    await pickType(user, /^Number/);
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ label: "Lead score", key: "lead_score", type: "number", insertAt: 2 })));
    rerender(<ColumnPanel {...props} opened={false} />);
    expect(onDraftChange).toHaveBeenLastCalledWith(null);
  });

  it("does not fire onDraftChange before a type is chosen", async () => {
    vi.useFakeTimers();
    try {
      const onDraftChange = vi.fn();
      renderUi(<ColumnPanel {...baseProps({ onDraftChange })} />);
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(onDraftChange).toHaveBeenLastCalledWith(null);
      expect(onDraftChange.mock.calls.every(([d]) => d === null)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("summarises and edits access in the 'Who can access' section", async () => {
    const { user, onSave } = setup();
    const section = screen.getByRole("button", { name: /Who can access/ });
    expect(section).toHaveTextContent("Everyone can view · Everyone can edit");
    await user.click(section);
    await user.click(within(screen.getByRole("radiogroup", { name: "Can view" })).getByRole("radio", { name: "Only roles…" }));
    await user.click(within(screen.getByRole("group", { name: "Can view roles" })).getByRole("button", { name: "Admin" }));
    await user.type(name(), "Secret notes");
    await pickType(user, /^Text/);
    await user.click(primary());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } });
  });

  it("keeps the draft when the host passes an equal but new column object", async () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const props = baseProps({ column });
    const { user, rerender } = renderUi(<ColumnPanel {...props} />);
    await user.clear(name());
    await user.type(name(), "Edited");
    rerender(<ColumnPanel {...props} column={{ ...column }} />);
    expect(name()).toHaveValue("Edited");
  });

  it("starts a fresh draft when reopened", async () => {
    const props = baseProps();
    const { user, rerender } = renderUi(<ColumnPanel {...props} />);
    await user.type(name(), "Temp");
    rerender(<ColumnPanel {...props} opened={false} />);
    rerender(<ColumnPanel {...props} opened />);
    expect(name()).toHaveValue("");
  });
});
