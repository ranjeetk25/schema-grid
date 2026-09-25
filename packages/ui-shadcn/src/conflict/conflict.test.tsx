import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChangeConflict } from "../internal/core-contracts";
import { type UiRendererProps, extendWithWidgets } from "../internal/grid-contracts";
import { getSelectOptions } from "../internal/options";
import { FIXTURE_IDS, buildFixtureRegistry, buildStubUiRegistry, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import { ConflictPopover } from "./ConflictPopover";
import { RemoteChangedBadge } from "./RemoteChangedBadge";

const NOW = new Date("2026-09-25T10:00:00Z");
const FIVE_MIN_AGO = new Date(NOW.getTime() - 5 * 60_000).toISOString();

function BadgeRenderer({ value, config }: UiRendererProps<string>) {
  const label = getSelectOptions(config).find((o) => o.id === value)?.label ?? "";
  return <span data-testid="their-badge">{label}</span>;
}

const conflict = (overrides: Partial<ChangeConflict> = {}): ChangeConflict => ({
  rowId: "r1",
  columnId: FIXTURE_IDS.payment,
  serverValue: "paid",
  serverVersion: 4,
  updatedBy: { id: "u_asha", name: "Asha" },
  updatedAt: FIVE_MIN_AGO,
  ...overrides,
});

function setup(c: ChangeConflict = conflict(), extra: { yourValue?: unknown } = {}) {
  const onResolve = vi.fn();
  const onClose = vi.fn();
  const r = renderUi(
    <ConflictPopover
      conflict={c}
      column={fixtureColumn(FIXTURE_IDS.payment)}
      registry={buildFixtureRegistry()}
      uiRegistry={extendWithWidgets(buildStubUiRegistry(), { select: { renderer: BadgeRenderer } })}
      now={NOW}
      opened
      onResolve={onResolve}
      onClose={onClose}
      {...extra}
    >
      <span>cell</span>
    </ConflictPopover>,
  );
  return { ...r, onResolve, onClose };
}

describe("ConflictPopover", () => {
  it("describes who changed it, when, and their value via the type renderer", () => {
    setup();
    expect(screen.getByText(/Asha changed this 5 minutes ago/)).toBeInTheDocument();
    expect(screen.getByTestId("their-badge")).toHaveTextContent("Paid");
  });

  it("renders your value through the same renderer when given", () => {
    setup(conflict(), { yourValue: "pending" });
    const badges = screen.getAllByTestId("their-badge");
    expect(badges.map((b) => b.textContent)).toEqual(["Paid", "Pending"]);
    expect(screen.getByText("Theirs")).toBeInTheDocument();
    expect(screen.getByText("Yours")).toBeInTheDocument();
  });

  it("the dialog is named by its own heading, not the (empty) anchor", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Edit conflict" });
    const heading = screen.getByRole("heading", { name: "Edit conflict" });
    expect(dialog).toContainElement(heading);
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("keep theirs and overwrite resolve", async () => {
    const { user, onResolve } = setup();
    await user.click(screen.getByRole("button", { name: "Keep theirs" }));
    expect(onResolve).toHaveBeenLastCalledWith("keepTheirs");
    await user.click(screen.getByRole("button", { name: "Overwrite" }));
    expect(onResolve).toHaveBeenLastCalledWith("overwrite");
  });

  it("falls back to someone, and Escape closes without resolving", async () => {
    const { user, onResolve, onClose } = setup(conflict({ updatedBy: undefined }));
    expect(screen.getByText(/Someone changed this/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep theirs" }));
    onResolve.mockClear();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("stays inside the container (not portalled)", () => {
    const { container } = renderUi(
      <ConflictPopover
        conflict={conflict()}
        column={fixtureColumn(FIXTURE_IDS.payment)}
        registry={buildFixtureRegistry()}
        uiRegistry={buildStubUiRegistry()}
        now={NOW}
        opened
        onResolve={() => {}}
      >
        <span>cell</span>
      </ConflictPopover>,
    );
    expect(container.contains(screen.getByRole("button", { name: "Overwrite" }))).toBe(true);
  });

  it("anchors to an external element / virtual rect when there are no children", () => {
    const cell = document.createElement("div");
    document.body.appendChild(cell);
    renderUi(
      <ConflictPopover
        conflict={conflict()}
        column={fixtureColumn(FIXTURE_IDS.payment)}
        registry={buildFixtureRegistry()}
        uiRegistry={buildStubUiRegistry()}
        now={NOW}
        opened
        anchor={cell}
        onResolve={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Edit conflict" })).toBeInTheDocument();
    cell.remove();
  });

  it("renders nothing when closed", () => {
    renderUi(
      <ConflictPopover
        conflict={conflict()}
        column={fixtureColumn(FIXTURE_IDS.payment)}
        registry={buildFixtureRegistry()}
        uiRegistry={buildStubUiRegistry()}
        now={NOW}
        opened={false}
        onResolve={() => {}}
      >
        <span>cell</span>
      </ConflictPopover>,
    );
    expect(screen.getByText("cell")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("RemoteChangedBadge", () => {
  it("shows a tooltip on hover", async () => {
    const { user } = renderUi(
      <RemoteChangedBadge updatedBy={{ id: "u", name: "Asha" }} updatedAt={new Date(NOW.getTime() - 2 * 60_000).toISOString()} now={NOW} />,
    );
    await user.hover(screen.getByLabelText("Changed by Asha · 2 minutes ago"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Changed by Asha · 2 minutes ago");
  });

  it("falls back to someone", () => {
    renderUi(<RemoteChangedBadge updatedAt={NOW.toISOString()} now={NOW} />);
    expect(screen.getByRole("img", { name: /Changed by someone/ })).toBeInTheDocument();
  });
});
