import { screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnPermissions } from "../internal/core-contracts";
import type { UserDirectory } from "../internal/people";
import { renderUi } from "../test/render";
import { PermissionsStep, editNotSubsetOfRead, permissionsError } from "./PermissionsStep";
import { describePermissions, setEditRule, setViewRule } from "./permissions-model";

const PEOPLE = [
  { id: "u-priya", name: "Priya" },
  { id: "u-rahul", name: "Rahul" },
  { id: "u-sam", name: "Sam" },
];

/** A fake directory over `PEOPLE`; `resolve` only knows those ids. */
function fakeDirectory() {
  return {
    search: vi.fn(async (q: string) => PEOPLE.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))),
    resolve: vi.fn(async (ids: string[]) => PEOPLE.filter((p) => ids.includes(p.id))),
  };
}

function Harness({
  onChange = () => {},
  initial,
  userDirectory,
}: {
  onChange?: (p: ColumnPermissions) => void;
  initial: ColumnPermissions;
  userDirectory?: UserDirectory;
}) {
  const [value, setValue] = useState<ColumnPermissions>(initial);
  return (
    <PermissionsStep
      value={value}
      roles={["admin", "finance_team"]}
      {...(userDirectory ? { userDirectory } : {})}
      onChange={(p) => {
        setValue(p);
        onChange(p);
      }}
    />
  );
}

const summary = () => screen.getByTestId("permissions-summary");

describe("PermissionsStep: per-person permissions (v0.4)", () => {
  it("without a userDirectory there is no People picker and existing users survive role edits", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(<Harness onChange={onChange} initial={{ read: "all", edit: { roles: ["admin"], users: ["u-priya"] } }} />);
    expect(screen.queryByRole("combobox", { name: /People that can/ })).toBeNull();
    expect(screen.getByText("Plus 1 specific person")).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Can edit roles" })).getByRole("button", { name: "Finance Team" }));
    expect(onChange).toHaveBeenLastCalledWith({ read: "all", edit: { roles: ["admin", "finance_team"], users: ["u-priya"] } });
  });

  it("picks people via userDirectory.search; an edit-only person is added to view with a note", async () => {
    const onChange = vi.fn();
    const dir = fakeDirectory();
    const { user } = renderUi(<Harness onChange={onChange} userDirectory={dir} initial={{ read: { roles: ["admin"] }, edit: { roles: ["admin"] } }} />);
    await user.click(screen.getByRole("combobox", { name: "People that can edit" }));
    const inputs = await screen.findAllByRole("combobox", { name: "People that can edit" });
    await user.type(inputs[inputs.length - 1] as HTMLElement, "pri");
    await waitFor(() => expect(dir.search).toHaveBeenLastCalledWith("pri"));
    await user.click(await screen.findByRole("option", { name: /Priya/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      read: { roles: ["admin"], users: ["u-priya"] },
      edit: { roles: ["admin"], users: ["u-priya"] },
    });
    expect(screen.getByText("Added Priya to Can view")).toBeInTheDocument();
    expect(summary()).toHaveTextContent("Only Admin and Priya can view · Only Admin and Priya can edit");
  });

  it("taking a person's view away also takes their edit", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(
      <Harness onChange={onChange} userDirectory={fakeDirectory()} initial={{ read: { users: ["u-priya", "u-rahul"] }, edit: { users: ["u-rahul"] } }} />,
    );
    const viewPeople = await screen.findByRole("list", { name: "People that can view" });
    await user.click(await within(viewPeople).findByRole("button", { name: "Remove Rahul" }));
    expect(onChange).toHaveBeenLastCalledWith({ read: { users: ["u-priya"] }, edit: { users: [] } });
    expect(screen.getByText("Removed Rahul from Can edit")).toBeInTheDocument();
  });

  it("names stored ids via resolve; unknown ids show the raw id marked unknown user", async () => {
    const dir = fakeDirectory();
    renderUi(<Harness userDirectory={dir} initial={{ read: "all", edit: { roles: ["finance_team"], users: ["u-priya", "u-gone"] } }} />);
    await waitFor(() => expect(summary()).toHaveTextContent("Only Finance Team and Priya, u-gone can edit"));
    expect(dir.resolve).toHaveBeenCalledTimes(1);
    expect([...(dir.resolve.mock.calls[0]?.[0] as string[])].sort()).toEqual(["u-gone", "u-priya"]);
    expect(within(screen.getByRole("list", { name: "People that can edit" })).getByText("u-gone (unknown user)")).toBeInTheDocument();
  });

  it("an empty rule needs a role or a person; users alone are enough", () => {
    renderUi(<Harness userDirectory={fakeDirectory()} initial={{ read: "all", edit: { roles: [] } }} />);
    expect(screen.getByText("Choose at least one role or person")).toBeInTheDocument();
    expect(permissionsError({ read: "all", edit: {} })).toBeTruthy();
    expect(permissionsError({ read: "all", edit: { users: ["u-priya"] } })).toBeNull();
    expect(editNotSubsetOfRead({ read: { roles: ["admin"] }, edit: { users: ["u-priya"] } })).toBe(true);
    expect(editNotSubsetOfRead({ read: { users: ["u-priya"] }, edit: { users: ["u-priya"] } })).toBe(false);
  });
});

describe("permissions model: people (v0.4)", () => {
  it("keeps edit ⊆ view for people too", () => {
    expect(setEditRule({ read: { roles: ["a"] }, edit: { roles: ["a"] } }, { roles: ["a"], users: ["p"] }).value).toEqual({
      read: { roles: ["a"], users: ["p"] },
      edit: { roles: ["a"], users: ["p"] },
    });
    expect(setViewRule({ read: { roles: ["a"], users: ["p", "q"] }, edit: { users: ["q"] } }, { roles: ["a"], users: ["p"] }).value).toEqual({
      read: { roles: ["a"], users: ["p"] },
      edit: { users: [] },
    });
  });

  it("describes up to 3 names, then “N people”", () => {
    const names = new Map([
      ["a", "Asha"],
      ["b", "Bo"],
    ]);
    expect(describePermissions({ read: "all", edit: { roles: ["finance_team"], users: ["a", "b"] } }, {}, names)).toBe(
      "Everyone can view · Only Finance Team and Asha, Bo can edit",
    );
    expect(describePermissions({ read: { users: ["a", "b", "c", "d"] }, edit: { users: ["a"] } })).toBe(
      "Only 4 people can view · Only a can edit",
    );
  });
});
