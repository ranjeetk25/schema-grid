import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef, LinkRef } from "../internal/core-contracts";
import { isPopupEditor } from "../internal/grid-contracts";
import { FIXTURE_LINKS, FIXTURE_NOW, buildStubDataSource } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { LinkPickerEditor, LinkPickerPopupEditor } from "./LinkPickerEditor";

const linkColumn = (allowMultiple: boolean): ColumnDef => ({
  id: "col_lead",
  key: "lead",
  label: "Lead",
  type: "link",
  config: { target: "leads", multiple: allowMultiple },
  order: 0,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
});

function setup(overrides: Partial<Parameters<typeof LinkPickerEditor>[0]> = {}, allowMultiple = false) {
  const dataSource = buildStubDataSource();
  const column = linkColumn(allowMultiple);
  const props = {
    value: null,
    onChange: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
    column,
    config: column.config,
    dataSource,
    ...overrides,
  };
  const utils = renderWithMantine(<LinkPickerEditor {...props} />);
  return { ...utils, props, dataSource };
}

const LEAD_1 = FIXTURE_LINKS[0] as LinkRef;
const LEAD_2 = FIXTURE_LINKS[1] as LinkRef;

describe("LinkPickerEditor", () => {
  it("is exported as a popup editor", () => {
    expect(isPopupEditor(LinkPickerPopupEditor)).toBe(true);
    expect(LinkPickerPopupEditor.component).toBe(LinkPickerEditor);
  });

  it("calls lookup with an empty search on open, then with the typed search", async () => {
    const { user, dataSource } = setup();
    await screen.findByText("Lead #1");
    expect(dataSource.lookup).toHaveBeenCalledWith("col_lead", "");
    await user.type(screen.getByRole("textbox"), "Lead #2");
    await waitFor(() => expect(dataSource.lookup).toHaveBeenLastCalledWith("col_lead", "Lead #2"));
  });

  it("selecting emits the LinkRef and commits", async () => {
    const { user, props } = setup();
    await user.click(await screen.findByRole("option", { name: "Lead #2" }));
    expect(props.onChange).toHaveBeenCalledWith([LEAD_2]);
    expect(props.onCommit).toHaveBeenCalledWith([LEAD_2]);
  });

  it("in multi mode accumulates picks as pills and Enter on empty search commits the array", async () => {
    const { user, props } = setup({}, true);
    await user.click(await screen.findByRole("option", { name: "Lead #1" }));
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onChange).toHaveBeenLastCalledWith([LEAD_1]);
    await user.click(screen.getByRole("option", { name: "Lead #2" }));
    expect(props.onChange).toHaveBeenLastCalledWith([LEAD_1, LEAD_2]);
    const pills = screen.getByTestId("link-picker-pills");
    expect(within(pills).getByText("Lead #1")).toBeInTheDocument();
    expect(within(pills).getByText("Lead #2")).toBeInTheDocument();
    await user.click(screen.getByRole("textbox"));
    await user.keyboard("{Enter}");
    expect(props.onCommit).toHaveBeenCalledWith([LEAD_1, LEAD_2]);
  });

  it("in multi mode a pill can be removed", async () => {
    const { user, props } = setup({ value: [LEAD_1, LEAD_2] }, true);
    const pills = screen.getByTestId("link-picker-pills");
    const removeButtons = pills.querySelectorAll("button");
    expect(removeButtons.length).toBe(2);
    await user.click(removeButtons[0] as HTMLElement);
    expect(props.onChange).toHaveBeenLastCalledWith([LEAD_2]);
    expect(within(pills).queryByText("Lead #1")).not.toBeInTheDocument();
  });

  it("in multi mode picking an already-linked record does not duplicate it", async () => {
    const { user, props } = setup({ value: [LEAD_1] }, true);
    await user.click(await screen.findByRole("option", { name: "Lead #1" }));
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("Escape cancels", async () => {
    const { user, props } = setup();
    await screen.findByText("Lead #1");
    await user.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("without lookup it shows the notice, is read-only and does not throw", () => {
    const { props } = setup({ dataSource: { ...buildStubDataSource(), lookup: undefined }, value: LEAD_1 });
    expect(screen.getByText("Lookup not configured")).toBeInTheDocument();
    expect(screen.getByText("Lead #1")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("without a data source at all it shows the notice", () => {
    setup({ dataSource: undefined });
    expect(screen.getByText("Lookup not configured")).toBeInTheDocument();
  });
});
