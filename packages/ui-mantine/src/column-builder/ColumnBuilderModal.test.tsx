import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_IDS,
  buildFixtureAccess,
  buildFixtureRegistry,
  buildFixtureSchema,
  buildStubUiRegistry,
  fixtureColumn,
} from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { ColumnBuilderModal, type ColumnBuilderModalProps } from "./ColumnBuilderModal";

const NOW = "2026-09-25T12:00:00.000Z";

function setup(overrides: Partial<ColumnBuilderModalProps> = {}) {
  const schema = buildFixtureSchema();
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const r = renderWithMantine(
    <ColumnBuilderModal
      opened
      onClose={() => {}}
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
  return { ...r, onSave, onDelete };
}

const next = () => screen.getByRole("button", { name: "Next" });

describe("ColumnBuilderModal", () => {
  it("creates a select column end to end", async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole("button", { name: "Single select" }));
    await user.click(next());
    await user.type(screen.getByRole("textbox", { name: /^Label/ }), "Payment Status");
    for (const [i, label] of ["Paid", "Pending", "Failed"].entries()) {
      await user.click(screen.getByRole("button", { name: "Add option" }));
      await user.type(screen.getAllByRole("textbox", { name: "Option label" })[i] as HTMLElement, label);
    }
    await user.click(next());
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Save column" }));
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
      { label: "Paid", value: "paid" },
      { label: "Pending", value: "pending" },
      { label: "Failed", value: "failed" },
    ]);
  });

  it("uses the plain slug when the key is free", async () => {
    const schema = buildFixtureSchema();
    schema.columns = schema.columns.filter((c) => c.key !== "payment_status");
    const { user, onSave } = setup({ schema, access: buildFixtureAccess(schema) });
    await user.click(screen.getByRole("button", { name: "Text" }));
    await user.click(next());
    await user.type(screen.getByRole("textbox", { name: /^Label/ }), "Payment Status");
    await user.click(next());
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Save column" }));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ key: "payment_status", type: "text" });
  });

  it("gates Next on the config step while the label is empty", async () => {
    const { user } = setup();
    expect(next()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Text" }));
    await user.click(next());
    // Next stays clickable on Config but refuses to advance and reveals why.
    await user.click(next());
    expect(screen.getByText("Label is required")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Label/ })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /^Label/ }), "X");
    await user.click(next());
    expect(screen.getByText("Read access")).toBeInTheDocument();
  });

  it("formula type shows the formula editor and invalid formulas block Next", async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole("button", { name: "Formula" }));
    await user.click(next());
    await user.type(screen.getByRole("textbox", { name: /^Label/ }), "Double");
    const formula = screen.getByRole("textbox", { name: /Formula/ });
    await user.type(formula, "{{amount} *");
    await user.click(next());
    expect(screen.queryByText("Read access")).not.toBeInTheDocument();
    await user.type(formula, " 2");
    await user.click(next());
    expect(screen.getByText("Read access")).toBeInTheDocument();
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Save column" }));
    await user.click(screen.getByRole("button", { name: "Save column" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ type: "formula", formula: "{amount} * 2", required: false });
  });

  it("edit mode locks the type and keeps the id", async () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const { user, onSave } = setup({ column });
    await user.click(screen.getByRole("button", { name: /Type/ }));
    expect(screen.queryByRole("button", { name: "Text" })).not.toBeInTheDocument();
    const label = screen.getByRole("textbox", { name: /^Label/ });
    await user.clear(label);
    await user.type(label, "Payment");
    await user.click(next());
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Save column" }));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ id: FIXTURE_IDS.payment, key: "payment_status", label: "Payment", type: "select" });
  });

  it("delete asks for confirmation", async () => {
    const { user, onDelete } = setup({ column: fixtureColumn(FIXTURE_IDS.payment) });
    await user.click(screen.getByRole("button", { name: "Delete column" }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Confirm delete" }));
    expect(onDelete).toHaveBeenCalledWith(FIXTURE_IDS.payment);
  });

  it("keeps the draft when the host passes an equal but new column object", async () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const props = {
      opened: true,
      onClose: () => {},
      schema: buildFixtureSchema(),
      registry: buildFixtureRegistry(),
      uiRegistry: buildStubUiRegistry(),
      access: buildFixtureAccess(),
      roles: [],
      onSave: () => {},
    };
    const { user, rerender } = renderWithMantine(<ColumnBuilderModal {...props} column={column} />);
    const label = screen.getByRole("textbox", { name: /^Label/ });
    await user.clear(label);
    await user.type(label, "Edited");
    rerender(<ColumnBuilderModal {...props} column={{ ...column }} />);
    expect(screen.getByRole("textbox", { name: /^Label/ })).toHaveValue("Edited");
  });

  it("starts a fresh draft when reopened", async () => {
    const props = {
      onClose: () => {},
      schema: buildFixtureSchema(),
      registry: buildFixtureRegistry(),
      uiRegistry: buildStubUiRegistry(),
      access: buildFixtureAccess(),
      roles: [],
      onSave: () => {},
    };
    const { user, rerender } = renderWithMantine(<ColumnBuilderModal {...props} opened />);
    await user.click(screen.getByRole("button", { name: "Text" }));
    expect(screen.getByRole("button", { name: "Text" })).toHaveAttribute("aria-pressed", "true");
    rerender(<ColumnBuilderModal {...props} opened={false} />);
    rerender(<ColumnBuilderModal {...props} opened />);
    expect(screen.getByRole("button", { name: "Text" })).toHaveAttribute("aria-pressed", "false");
  });
});
