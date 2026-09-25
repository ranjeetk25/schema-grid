import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import { ColumnBuilderDialog, ColumnBuilderModal, type ColumnBuilderModalProps } from "./ColumnBuilderDialog";

const NOW = "2026-09-25T12:00:00.000Z";

function setup(overrides: Partial<ColumnBuilderModalProps> = {}) {
  const schema = buildFixtureSchema();
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const r = renderUi(
    <ColumnBuilderModal
      opened
      onClose={onClose}
      schema={schema}
      registry={buildFixtureRegistry()}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      roles={["admin", "counsellor"]}
      onSave={onSave}
      onDelete={onDelete}
      now={() => NOW}
      generateId={() => "col_generated"}
      {...overrides}
    />,
  );
  return { ...r, onSave, onDelete, onClose };
}

const name = () => screen.getByRole("textbox", { name: /^Name/ });

describe("ColumnBuilderDialog / ColumnBuilderModal", () => {
  it("ColumnBuilderModal is an alias of ColumnBuilderDialog", () => {
    expect(ColumnBuilderModal).toBe(ColumnBuilderDialog);
  });

  it("creates a select column end to end in a modal dialog", async () => {
    const { user, onSave } = setup();
    expect(screen.getByRole("dialog", { name: "New column" })).toBeInTheDocument();
    await user.type(name(), "Payment Status");
    await user.click(screen.getByRole("button", { name: /^Type/ }));
    await user.click(await screen.findByRole("option", { name: /^Select/ }));
    for (const [i, label] of ["Paid", "Pending", "Failed"].entries()) {
      await user.click(screen.getByRole("button", { name: "Add option" }));
      await user.type(screen.getAllByRole("textbox", { name: "Option label" })[i] as HTMLElement, label);
    }
    await user.click(screen.getByRole("button", { name: "Create column" }));
    const saved = onSave.mock.calls[0]?.[0];
    expect(saved).toMatchObject({ id: "col_generated", key: "payment_status_2", label: "Payment Status", type: "select" });
    expect(saved.config.options).toEqual([
      { id: "paid", label: "Paid" },
      { id: "pending", label: "Pending" },
      { id: "failed", label: "Failed" },
    ]);
  });

  it("Enter in the name saves once the form is valid", async () => {
    const { user, onSave } = setup({ initialType: "text" });
    await user.type(name(), "Notes 2{Enter}");
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ key: "notes_2", type: "text" });
  });

  it("Esc with a dirty draft asks before closing; clean closes", async () => {
    const { user, onClose } = setup();
    await user.type(name(), "x");
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("alertdialog", { name: "Discard changes?" })).getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("edit mode saves with the same id and deletes after confirmation", async () => {
    const { user, onSave, onDelete } = setup({ column: fixtureColumn(FIXTURE_IDS.payment) });
    expect(screen.getByRole("dialog", { name: "Edit column" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ id: FIXTURE_IDS.payment, key: "payment_status" });
    await user.click(screen.getByRole("button", { name: "Delete column" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onDelete).toHaveBeenCalledWith(FIXTURE_IDS.payment);
  });
});
