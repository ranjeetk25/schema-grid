import { screen } from "@testing-library/react";
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

function props(overrides: Partial<ColumnBuilderModalProps> = {}): ColumnBuilderModalProps {
  const schema = buildFixtureSchema();
  return {
    opened: true,
    onClose: () => {},
    schema,
    registry: buildFixtureRegistry(),
    uiRegistry: buildStubUiRegistry(),
    access: buildFixtureAccess(schema),
    roles: ["admin", "counsellor"],
    onSave: vi.fn(),
    now: () => NOW,
    generateId: () => "col_generated",
    ...overrides,
  };
}

/** Deprecated wrapper: the same form as ColumnPanel inside a modal. The form itself is covered by ColumnPanel.test. */
describe("ColumnBuilderModal (deprecated wrapper)", () => {
  it("is a dialog named 'Add column' that creates a column", async () => {
    const p = props();
    const { user } = renderWithMantine(<ColumnBuilderModal {...p} />);
    expect(screen.getByRole("dialog", { name: "Add column" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Payment Status");
    await user.click(screen.getByRole("button", { name: "Create column" }));
    expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ key: "payment_status_2", type: "text" }), undefined);
  });

  it("is named 'Edit column' in edit mode and keeps the draft across equal re-renders", async () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const p = props({ column });
    const { user, rerender } = renderWithMantine(<ColumnBuilderModal {...p} />);
    expect(screen.getByRole("dialog", { name: "Edit column" })).toBeInTheDocument();
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Edited");
    rerender(<ColumnBuilderModal {...p} column={{ ...column }} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Edited");
  });

  it("starts a fresh draft when reopened", async () => {
    const p = props();
    const { user, rerender } = renderWithMantine(<ColumnBuilderModal {...p} />);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Temp");
    rerender(<ColumnBuilderModal {...p} opened={false} />);
    rerender(<ColumnBuilderModal {...p} opened />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
  });
});
