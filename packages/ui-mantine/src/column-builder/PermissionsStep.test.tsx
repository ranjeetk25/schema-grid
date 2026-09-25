import { screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnPermissions } from "../internal/core-contracts";
import { renderWithMantine } from "../test/render";
import { PermissionsStep, permissionsError } from "./PermissionsStep";

function Harness({ onChange }: { onChange: (p: ColumnPermissions) => void }) {
  const [value, setValue] = useState<ColumnPermissions>({ read: "all", edit: "all" });
  return (
    <PermissionsStep
      value={value}
      roles={["admin", "counsellor", "finance"]}
      onChange={(p) => {
        setValue(p);
        onChange(p);
      }}
    />
  );
}

describe("PermissionsStep", () => {
  it("switches read to roles and warns when editors are not a subset of readers", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(<Harness onChange={onChange} />);
    await user.click(screen.getAllByText("Roles")[0] as HTMLElement);
    expect(screen.getByText("Choose at least one role")).toBeInTheDocument();
    await user.click(screen.getByRole("textbox", { name: "Read roles" }));
    await user.click(screen.getByRole("option", { name: "counsellor" }));
    expect(onChange).toHaveBeenLastCalledWith({ read: { roles: ["counsellor"] }, edit: "all" });
    expect(screen.getByText(/can edit but not read/)).toBeInTheDocument();
    expect(screen.queryByText("Choose at least one role")).not.toBeInTheDocument();
  });

  it("permissionsError flags empty role lists", () => {
    expect(permissionsError({ read: { roles: [] }, edit: "all" })).toBeTruthy();
    expect(permissionsError({ read: "all", edit: { roles: ["admin"] } })).toBeNull();
  });
});
