import { fireEvent } from "@testing-library/react";
import dayjs from "dayjs";
import { describe, expect, it, vi } from "vitest";
import { fixtureColumn, FIXTURE_IDS } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { DateEditor, DateTimeEditor } from "./DateEditors";

/**
 * jsdom's floating-ui geometry is degenerate (every element is a zero-size
 * rect), so Mantine's Popover `hide()` middleware marks the dropdown
 * `display:none` even while `opened` is true. That hides it from
 * accessible-role queries (`getByRole` et al. exclude non-visible nodes), so
 * these tests query with `{ hidden: true }` to include it, and drive clicks
 * with `fireEvent` (which does not gate on visibility) instead of
 * `user-event` (which does).
 */
describe("DateEditor", () => {
  it("renders the calendar inside the render container (portal guarantee)", async () => {
    const { container, user, getByRole, findAllByRole } = renderWithMantine(
      <DateEditor
        value="2026-09-01"
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.call)}
        config={{}}
      />,
      { env: "default" },
    );
    await user.click(getByRole("button"));
    const dayButtons = await findAllByRole("button", { name: /^15 /, hidden: true });
    expect(dayButtons.length).toBeGreaterThan(0);
    for (const btn of dayButtons) expect(container.contains(btn)).toBe(true);
  });

  it("picking day 15 emits the matching core date value", async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { user, getByRole, findAllByRole } = renderWithMantine(
      <DateEditor
        value="2026-09-01"
        onChange={onChange}
        onCommit={onCommit}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.call)}
        config={{}}
      />,
      { env: "default" },
    );
    await user.click(getByRole("button"));
    const [day15] = await findAllByRole("button", { name: /^15 /, hidden: true });
    fireEvent.click(day15 as HTMLElement);
    expect(onChange).toHaveBeenCalledWith("2026-09-15");
    expect(onCommit).toHaveBeenCalledWith("2026-09-15");
  });

  it("Escape cancels without emitting a change", async () => {
    const onChange = vi.fn();
    const onCancel = vi.fn();
    const { user, getByRole } = renderWithMantine(
      <DateEditor
        value={null}
        onChange={onChange}
        onCommit={vi.fn()}
        onCancel={onCancel}
        column={fixtureColumn(FIXTURE_IDS.call)}
        config={{}}
      />,
      { env: "default" },
    );
    const trigger = getByRole("button");
    trigger.focus();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DateTimeEditor", () => {
  it("emits an ISO value that includes the time", async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { user, getByRole, findAllByRole } = renderWithMantine(
      <DateTimeEditor
        value="2026-09-01T00:00:00.000Z"
        onChange={onChange}
        onCommit={onCommit}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.call)}
        config={{}}
      />,
      { env: "default" },
    );
    await user.click(getByRole("button"));
    const [day15] = await findAllByRole("button", { name: /^15 /, hidden: true });
    fireEvent.click(day15 as HTMLElement);
    expect(onChange).toHaveBeenCalled();
    const emitted = onChange.mock.calls.at(-1)?.[0] as string;
    expect(dayjs(emitted).isValid()).toBe(true);
    expect(emitted).toMatch(/T\d{2}:\d{2}/);
  });
});
