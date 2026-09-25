import { screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnPermissions } from "../internal/core-contracts";
import { renderUi } from "../test/render";
import { PermissionsStep, editNotSubsetOfRead, permissionsError } from "./PermissionsStep";
import { describePermissions, hiddenFromRoles, setEditRule, setViewRule, titleCaseRole } from "./permissions-model";

const ROLES = ["admin", "counsellor", "finance"];

function Harness({
  onChange = () => {},
  initial = { read: "all", edit: "all" },
  computed,
}: {
  onChange?: (p: ColumnPermissions) => void;
  initial?: ColumnPermissions;
  computed?: boolean;
}) {
  const [value, setValue] = useState<ColumnPermissions>(initial);
  return (
    <PermissionsStep
      value={value}
      roles={ROLES}
      computed={computed}
      onChange={(p) => {
        setValue(p);
        onChange(p);
      }}
    />
  );
}

const viewGroup = () => screen.getByRole("radiogroup", { name: "Can view" });
const editGroup = () => screen.getByRole("radiogroup", { name: "Can edit" });
const summary = () => screen.getByTestId("permissions-summary");

describe("PermissionsStep", () => {
  it("switches view to roles, asks for a role, then summarises in plain English", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(<Harness onChange={onChange} />);
    expect(summary()).toHaveTextContent("Everyone can view · Everyone can edit");
    await user.click(within(viewGroup()).getByRole("radio", { name: "Only roles…" }));
    expect(screen.getAllByText("Choose at least one role").length).toBeGreaterThan(0);
    await user.click(within(screen.getByRole("group", { name: "Can view roles" })).getByRole("button", { name: "Counsellor" }));
    expect(onChange).toHaveBeenLastCalledWith({ read: { roles: ["counsellor"] }, edit: { roles: ["counsellor"] } });
    expect(screen.queryByText("Choose at least one role")).not.toBeInTheDocument();
    expect(summary()).toHaveTextContent("Only Counsellor can view · Only Counsellor can edit");
    expect(editNotSubsetOfRead(onChange.mock.lastCall?.[0])).toBe(false);
  });

  it("auto-adds an edit role to Can view, with a note", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(<Harness onChange={onChange} initial={{ read: { roles: ["admin"] }, edit: { roles: ["admin"] } }} />);
    await user.click(within(screen.getByRole("group", { name: "Can edit roles" })).getByRole("button", { name: "Counsellor" }));
    expect(onChange).toHaveBeenLastCalledWith({ read: { roles: ["admin", "counsellor"] }, edit: { roles: ["admin", "counsellor"] } });
    expect(screen.getByText("Added Counsellor to Can view")).toBeInTheDocument();
    expect(summary()).toHaveTextContent("Only Admin, Counsellor can view · Only Admin, Counsellor can edit");
  });

  it("trims Can edit when Can view narrows", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(
      <Harness onChange={onChange} initial={{ read: { roles: ["admin", "finance"] }, edit: { roles: ["admin", "finance"] } }} />,
    );
    await user.click(within(screen.getByRole("group", { name: "Can view roles" })).getByRole("button", { name: "Finance" }));
    expect(onChange).toHaveBeenLastCalledWith({ read: { roles: ["admin"] }, edit: { roles: ["admin"] } });
    expect(screen.getByText("Removed Finance from Can edit")).toBeInTheDocument();
  });

  it("lists the roles the column is hidden from", () => {
    renderUi(<Harness initial={{ read: { roles: ["admin"] }, edit: { roles: ["admin"] } }} />);
    const list = screen.getByRole("list", { name: "Hidden from" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Counsellor", "Finance"]);
  });

  it("formula columns hide the Can edit row and say they are computed", () => {
    renderUi(<Harness computed />);
    expect(viewGroup()).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Can edit" })).not.toBeInTheDocument();
    expect(screen.getByText("Computed — read-only for everyone")).toBeInTheDocument();
    expect(summary()).toHaveTextContent("Everyone can view · Computed, read-only for everyone");
  });

  it("choosing Everyone for Can edit opens Can view to everyone", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(<Harness onChange={onChange} initial={{ read: { roles: ["admin"] }, edit: { roles: ["admin"] } }} />);
    await user.click(within(editGroup()).getByRole("radio", { name: "Everyone" }));
    expect(onChange).toHaveBeenLastCalledWith({ read: "all", edit: "all" });
    expect(screen.getByText("Can view set to Everyone")).toBeInTheDocument();
  });

  it("permissionsError flags empty role lists", () => {
    expect(permissionsError({ read: { roles: [] }, edit: "all" })).toBeTruthy();
    expect(permissionsError({ read: "all", edit: { roles: ["admin"] } })).toBeNull();
  });
});

describe("permissions model", () => {
  it("title-cases roles", () => {
    expect(titleCaseRole("counsellor")).toBe("Counsellor");
    expect(titleCaseRole("sales_lead")).toBe("Sales Lead");
  });

  it("keeps edit ⊆ view in both directions", () => {
    expect(setEditRule({ read: { roles: ["a"] }, edit: { roles: ["a"] } }, { roles: ["b"] }).value).toEqual({
      read: { roles: ["a", "b"] },
      edit: { roles: ["b"] },
    });
    expect(setViewRule({ read: "all", edit: "all" }, { roles: ["a"] }).value).toEqual({ read: { roles: ["a"] }, edit: { roles: ["a"] } });
    expect(setViewRule({ read: "all", edit: { roles: ["a", "b"] } }, "all").value).toEqual({ read: "all", edit: { roles: ["a", "b"] } });
  });

  it("describes and lists hidden roles", () => {
    expect(describePermissions({ read: "all", edit: { roles: ["admin", "counsellor"] } })).toBe(
      "Everyone can view · Only Admin, Counsellor can edit",
    );
    expect(hiddenFromRoles({ read: "all", edit: "all" }, ROLES)).toEqual([]);
  });
});
