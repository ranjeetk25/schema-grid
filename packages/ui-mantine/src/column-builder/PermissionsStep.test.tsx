import { screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnPermissions } from "../internal/core-contracts";
import { renderWithMantine } from "../test/render";
import { AccessSection, accessSummary, permissionsError } from "./PermissionsStep";

function Harness({ onChange, computed, initial = { read: "all", edit: "all" } }: { onChange: (p: ColumnPermissions) => void; computed?: boolean; initial?: ColumnPermissions }) {
  const [value, setValue] = useState<ColumnPermissions>(initial);
  return (
    <AccessSection
      value={value}
      roles={["admin", "counsellor", "viewer"]}
      computed={computed}
      onChange={(p) => {
        setValue(p);
        onChange(p);
      }}
    />
  );
}

describe("AccessSection (Who can access)", () => {
  it("limits viewing to roles, summarises in plain English and shows who it's hidden from", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(<Harness onChange={onChange} />);
    expect(screen.getByTestId("access-summary")).toHaveTextContent("Everyone can view · everyone can edit");
    await user.click(screen.getAllByText("Only roles…")[0] as HTMLElement);
    expect(screen.getByText("Pick at least one role")).toBeInTheDocument();
    await user.click(screen.getByRole("textbox", { name: "Roles that can view" }));
    await user.click(screen.getByRole("option", { name: "Counsellor" }));
    expect(onChange).toHaveBeenLastCalledWith({ read: { roles: ["counsellor"] }, edit: "all" });
    expect(screen.getByTestId("access-summary")).toHaveTextContent("Only Counsellor can view · all of them can edit");
    expect(screen.getByText("Hidden from: Admin, Viewer")).toBeInTheDocument();
    expect(screen.getByText("Everyone who can view")).toBeInTheDocument();
  });

  it("giving a role edit also gives it view (with a note)", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(
      <Harness onChange={onChange} initial={{ read: { roles: ["admin"] }, edit: { roles: ["admin"] } }} />,
    );
    await user.click(screen.getByRole("textbox", { name: "Roles that can edit" }));
    await user.click(screen.getByRole("option", { name: "Counsellor" }));
    expect(onChange).toHaveBeenLastCalledWith({ read: { roles: ["admin", "counsellor"] }, edit: { roles: ["admin", "counsellor"] } });
    expect(screen.getByRole("status")).toHaveTextContent("Counsellor can now view it too");
  });

  it("formula columns only ask who can view", () => {
    renderWithMantine(<Harness onChange={() => {}} computed />);
    expect(screen.getByText("Computed — read-only for everyone.")).toBeInTheDocument();
    expect(screen.queryByText("Can edit")).not.toBeInTheDocument();
  });

  it("permissionsError flags empty role lists; accessSummary reads naturally", () => {
    expect(permissionsError({ read: { roles: [] }, edit: "all" })).toBeTruthy();
    expect(permissionsError({ read: "all", edit: { roles: ["admin"] } })).toBeNull();
    expect(accessSummary({ read: "all", edit: { roles: ["admin", "finance_team"] } })).toBe("Everyone can view · only Admin and Finance team can edit");
  });
});
