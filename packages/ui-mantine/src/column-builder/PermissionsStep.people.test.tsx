import { screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnPermissions } from "../internal/core-contracts";
import type { UserDirectory } from "../internal/people";
import { renderWithMantine } from "../test/render";
import { AccessSection, accessSummary, editNotSubsetOfRead, permissionsError } from "./PermissionsStep";

const PEOPLE = [
  { id: "u-priya", name: "Priya" },
  { id: "u-rahul", name: "Rahul" },
  { id: "u-sam", name: "Sam" },
];

/** A fake directory over `PEOPLE`; `resolve` only knows those ids. */
function fakeDirectory(): UserDirectory & { search: ReturnType<typeof vi.fn>; resolve: ReturnType<typeof vi.fn> } {
  return {
    search: vi.fn(async (q: string) => PEOPLE.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))),
    resolve: vi.fn(async (ids: string[]) => PEOPLE.filter((p) => ids.includes(p.id))),
  };
}

function Harness({
  onChange,
  initial,
  userDirectory,
}: {
  onChange: (p: ColumnPermissions) => void;
  initial: ColumnPermissions;
  userDirectory?: UserDirectory;
}) {
  const [value, setValue] = useState<ColumnPermissions>(initial);
  return (
    <AccessSection
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

describe("AccessSection: per-person permissions (v0.4)", () => {
  it("without a userDirectory there is no People picker and existing users survive role edits", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(
      <Harness onChange={onChange} initial={{ read: "all", edit: { roles: ["admin"], users: ["u-priya"] } }} />,
    );
    expect(screen.queryByRole("textbox", { name: /People that can/ })).toBeNull();
    expect(screen.getByText("Plus 1 specific person")).toBeInTheDocument();
    await user.click(screen.getByRole("textbox", { name: "Roles that can edit" }));
    await user.click(screen.getByRole("option", { name: "Finance team" }));
    expect(onChange).toHaveBeenLastCalledWith({ read: "all", edit: { roles: ["admin", "finance_team"], users: ["u-priya"] } });
  });

  it("picks people via userDirectory.search; an edit-only person is added to view with a note", async () => {
    const onChange = vi.fn();
    const dir = fakeDirectory();
    const { user } = renderWithMantine(
      <Harness onChange={onChange} userDirectory={dir} initial={{ read: { roles: ["admin"] }, edit: { roles: ["admin"] } }} />,
    );
    await user.click(screen.getByRole("textbox", { name: "People that can edit" }));
    await user.type(screen.getByRole("textbox", { name: "People that can edit" }), "pri");
    await waitFor(() => expect(dir.search).toHaveBeenLastCalledWith("pri"));
    await user.click(await screen.findByRole("option", { name: /Priya/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      read: { roles: ["admin"], users: ["u-priya"] },
      edit: { roles: ["admin"], users: ["u-priya"] },
    });
    expect(screen.getByRole("status")).toHaveTextContent("Priya can now view it too");
    expect(screen.getByTestId("access-summary")).toHaveTextContent("Only Admin and Priya can view · only Admin and Priya can edit");
  });

  it("taking a person's view away also takes their edit", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(
      <Harness
        onChange={onChange}
        userDirectory={fakeDirectory()}
        initial={{ read: { users: ["u-priya", "u-rahul"] }, edit: { users: ["u-rahul"] } }}
      />,
    );
    const viewPeople = await screen.findByTestId("people-can-view");
    await user.click(await within(viewPeople).findByRole("button", { name: "Remove Rahul" }));
    expect(onChange).toHaveBeenLastCalledWith({ read: { users: ["u-priya"] }, edit: { users: [] } });
    expect(screen.getByRole("status")).toHaveTextContent("Rahul can no longer edit either");
  });

  it("names stored ids via resolve; unknown ids show the raw id marked unknown user", async () => {
    const dir = fakeDirectory();
    renderWithMantine(
      <Harness onChange={() => {}} userDirectory={dir} initial={{ read: "all", edit: { roles: ["finance_team"], users: ["u-priya", "u-gone"] } }} />,
    );
    await waitFor(() => expect(screen.getByTestId("access-summary")).toHaveTextContent("only Finance team and Priya, u-gone can edit"));
    expect(dir.resolve).toHaveBeenCalledTimes(1);
    expect([...(dir.resolve.mock.calls[0]?.[0] as string[])].sort()).toEqual(["u-gone", "u-priya"]);
    expect(within(screen.getByTestId("people-can-edit")).getByText("u-gone (unknown user)")).toBeInTheDocument();
  });

  it("an empty rule needs a role or a person; users alone are enough", async () => {
    renderWithMantine(<Harness onChange={() => {}} userDirectory={fakeDirectory()} initial={{ read: "all", edit: { roles: [] } }} />);
    expect(screen.getByText("Pick at least one role or person")).toBeInTheDocument();
    expect(permissionsError({ read: "all", edit: {} })).toBeTruthy();
    expect(permissionsError({ read: "all", edit: { users: ["u-priya"] } })).toBeNull();
    expect(editNotSubsetOfRead({ read: { roles: ["admin"] }, edit: { users: ["u-priya"] } })).toBe(true);
    expect(editNotSubsetOfRead({ read: { users: ["u-priya"] }, edit: { users: ["u-priya"] } })).toBe(false);
  });

  it("accessSummary lists up to 3 names, then “N people”", () => {
    const names = new Map([
      ["a", "Asha"],
      ["b", "Bo"],
    ]);
    expect(accessSummary({ read: "all", edit: { roles: ["finance_team"], users: ["a", "b"] } }, false, names)).toBe(
      "Everyone can view · only Finance team and Asha, Bo can edit",
    );
    expect(accessSummary({ read: { users: ["a", "b", "c", "d"] }, edit: "all" }, false, names)).toBe(
      "Only 4 people can view · all of them can edit",
    );
    expect(accessSummary({ read: { users: ["a"] }, edit: "all" })).toBe("Only a can view · all of them can edit");
  });
});
