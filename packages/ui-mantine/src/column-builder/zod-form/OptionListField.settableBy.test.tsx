import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../../test/render";
import { OptionListField, settableBySummary } from "./OptionListField";

const options = [
  { id: "new", label: "New" },
  { id: "verified", label: "Verified", settableBy: { roles: ["admin"] } },
];

describe("OptionListField: Who can set (v0.3)", () => {
  it("summarises each option's settableBy and hides the control without roles", () => {
    expect(settableBySummary(undefined)).toBe("Everyone");
    expect(settableBySummary("all")).toBe("Everyone");
    expect(settableBySummary({ roles: ["admin", "finance_team"] })).toBe("Only Admin and Finance team");
    expect(settableBySummary({ roles: [] })).toBe("Nobody yet");
    renderWithMantine(<OptionListField label="Options" value={options} onChange={() => {}} hasColor valueKey="id" />);
    expect(screen.queryByTestId("option-settable-by")).toBeNull();
  });

  it("round-trips settableBy: restricting an option writes { roles }, going back to Everyone removes the key", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(
      <OptionListField label="Options" value={options} onChange={onChange} hasColor valueKey="id" roles={["admin", "counsellor"]} />,
    );
    const pills = screen.getAllByTestId("option-settable-by");
    expect(pills[0]).toHaveTextContent("Everyone");
    expect(pills[1]).toHaveTextContent("Only Admin");

    await user.click(pills[0] as HTMLElement);
    await user.click(screen.getByRole("radio", { name: "Only roles…" }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: "new", label: "New", settableBy: { roles: [] } }, options[1]]);
    await user.click(screen.getByRole("textbox", { name: "Roles that can set New" }));
    await user.click(screen.getByRole("option", { name: "Counsellor" }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: "new", label: "New", settableBy: { roles: ["counsellor"] } }, options[1]]);

    await user.click(screen.getAllByTestId("option-settable-by")[1] as HTMLElement);
    const dialogs = screen.getAllByRole("dialog");
    await user.click(within(dialogs[dialogs.length - 1] as HTMLElement).getByRole("radio", { name: "Everyone" }));
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>[];
    expect(last[1]).toEqual({ id: "verified", label: "Verified" });
    expect("settableBy" in (last[1] as object)).toBe(false);
  });
});
