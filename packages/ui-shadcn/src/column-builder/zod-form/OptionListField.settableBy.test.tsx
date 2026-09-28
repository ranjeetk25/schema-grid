import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserDirectoryProvider } from "../../internal/people";
import { renderUi } from "../../test/render";
import { OptionListField, settableBySummary } from "./OptionListField";

const options = [
  { id: "new", label: "New" },
  { id: "verified", label: "Verified", settableBy: { roles: ["admin"] } },
];

describe("OptionListField: Who can set (v0.3)", () => {
  it("summarises each option's settableBy and hides the control without roles", () => {
    expect(settableBySummary(undefined)).toBe("Everyone");
    expect(settableBySummary("all")).toBe("Everyone");
    expect(settableBySummary({ roles: ["admin", "finance_team"] })).toBe("Only Admin and Finance Team");
    expect(settableBySummary({ roles: [] })).toBe("Nobody yet");
    renderUi(<OptionListField label="Options" value={options} onChange={() => {}} hasColor valueKey="id" />);
    expect(screen.queryByTestId("option-settable-by")).toBeNull();
  });

  it("round-trips settableBy: restricting an option writes { roles }, going back to Everyone removes the key", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(
      <OptionListField label="Options" value={options} onChange={onChange} hasColor valueKey="id" roles={["admin", "counsellor"]} />,
    );
    const pills = screen.getAllByTestId("option-settable-by");
    expect(pills[0]).toHaveTextContent("Everyone");
    expect(pills[1]).toHaveTextContent("Only Admin");

    await user.click(pills[0] as HTMLElement);
    const first = await screen.findByRole("dialog", { name: "Who can set New" });
    await user.click(within(first).getByRole("radio", { name: "Only roles…" }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: "new", label: "New", settableBy: { roles: [] } }, options[1]]);
    await user.click(within(first).getByRole("button", { name: "Counsellor" }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: "new", label: "New", settableBy: { roles: ["counsellor"] } }, options[1]]);

    await user.keyboard("{Escape}");
    await user.click(screen.getAllByTestId("option-settable-by")[1] as HTMLElement);
    const second = await screen.findByRole("dialog", { name: "Who can set Verified" });
    await user.click(within(second).getByRole("radio", { name: "Everyone" }));
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>[];
    expect(last[1]).toEqual({ id: "verified", label: "Verified" });
    expect("settableBy" in (last[1] as object)).toBe(false);
  });
});

describe("OptionListField: Who can set, per person (v0.4)", () => {
  const directory = {
    search: vi.fn(async () => [{ id: "u-priya", name: "Priya" }]),
    resolve: vi.fn(async (ids: string[]) => (ids.includes("u-priya") ? [{ id: "u-priya", name: "Priya" }] : [])),
  };

  it("summaries count people; a users-only rule is kept when read back", () => {
    expect(settableBySummary({ roles: ["admin"], users: ["u-priya"] }, new Map([["u-priya", "Priya"]]))).toBe("Only Admin and Priya");
    expect(settableBySummary({ users: ["a", "b", "c", "d"] })).toBe("Only 4 people");
    expect(settableBySummary({})).toBe("Nobody yet");
    renderUi(
      <OptionListField label="Options" value={[{ id: "w", label: "Waived", settableBy: { users: ["u-priya"] } }]} onChange={() => {}} hasColor valueKey="id" roles={["admin"]} />,
    );
    expect(screen.getByTestId("option-settable-by")).toHaveTextContent("Only u-priya");
  });

  it("the popover gets a People picker when a userDirectory is given (prop or context)", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(
      <UserDirectoryProvider value={directory}>
        <OptionListField label="Options" value={[{ id: "w", label: "Waived", settableBy: { roles: ["admin"] } }]} onChange={onChange} hasColor valueKey="id" roles={["admin"]} />
      </UserDirectoryProvider>,
    );
    await user.click(screen.getByTestId("option-settable-by"));
    const dialog = await screen.findByRole("dialog", { name: "Who can set Waived" });
    await user.click(within(dialog).getByRole("combobox", { name: "People that can set Waived" }));
    await user.click(await screen.findByRole("option", { name: /Priya/ }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: "w", label: "Waived", settableBy: { roles: ["admin"], users: ["u-priya"] } }]);
    expect(screen.getByTestId("option-settable-by")).toHaveTextContent("Only Admin and Priya");
  });
});
