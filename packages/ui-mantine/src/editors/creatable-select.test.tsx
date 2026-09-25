import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef, Option } from "../internal/core-contracts";
import { isPopupEditor } from "../internal/grid-contracts";
import { FIXTURE_NOW, PAYMENT_OPTIONS, buildStubDataSource } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { CreatableSelectEditor, CreatableSelectPopupEditor } from "./CreatableSelectEditor";

const COLUMN: ColumnDef = {
  id: "col_stage",
  key: "stage",
  label: "Stage",
  type: "creatableSelect",
  config: { options: PAYMENT_OPTIONS },
  order: 0,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
};

function setup(overrides: Partial<Parameters<typeof CreatableSelectEditor>[0]> = {}, env: "test" | "default" = "test") {
  const dataSource = buildStubDataSource();
  const props = {
    onChange: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
    onOptionCreate: vi.fn(),
  };
  const utils = renderWithMantine(
    <CreatableSelectEditor value={null} column={COLUMN} config={COLUMN.config} dataSource={dataSource} {...props} {...overrides} />,
    { env },
  );
  return { ...utils, props, dataSource };
}

describe("CreatableSelectEditor", () => {
  it("is exported as a popup editor", () => {
    expect(isPopupEditor(CreatableSelectPopupEditor)).toBe(true);
    expect(CreatableSelectPopupEditor.component).toBe(CreatableSelectEditor);
  });

  it("opens on mount in grid mode and lists the configured options", () => {
    setup();
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.getByRole("option", { name: "Paid" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Failed" })).toBeInTheDocument();
  });

  it("does not auto-open or grab focus when autoFocus is false", () => {
    setup({ autoFocus: false });
    expect(screen.getByRole("textbox")).not.toHaveFocus();
    expect(screen.queryByRole("option", { name: "Paid" })).not.toBeInTheDocument();
  });

  it("keeps the dropdown inside the container with portals enabled", () => {
    const { container } = setup({}, "default");
    const option = screen.getByText("Pending");
    expect(container.contains(option)).toBe(true);
  });

  it("typing an existing label (any case) shows no create option", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("textbox"), "paid");
    expect(screen.getByRole("option", { name: "Paid" })).toBeInTheDocument();
    expect(screen.queryByText(/Create '/)).not.toBeInTheDocument();
  });

  it("typing a new label shows the create option; clicking it creates, emits and commits", async () => {
    const { user, props, dataSource } = setup();
    await user.type(screen.getByRole("textbox"), "Refunded");
    const create = screen.getByRole("option", { name: "Create 'Refunded'" });
    await user.click(create);
    await waitFor(() => expect(props.onCommit).toHaveBeenCalledWith("refunded"));
    expect(dataSource.createOption).toHaveBeenCalledWith("col_stage", "Refunded");
    const created: Option = { label: "Refunded", value: "refunded" };
    expect(props.onOptionCreate).toHaveBeenCalledWith(created);
    expect(props.onChange).toHaveBeenCalledWith("refunded");
    const createOrder = props.onOptionCreate.mock.invocationCallOrder[0] ?? 0;
    const changeOrder = props.onChange.mock.invocationCallOrder[0] ?? 0;
    const commitOrder = props.onCommit.mock.invocationCallOrder[0] ?? 0;
    expect(createOrder).toBeLessThan(changeOrder);
    expect(changeOrder).toBeLessThan(commitOrder);
  });

  it("shows a loader and disables the input while creating", async () => {
    let resolve: (o: Option) => void = () => {};
    const { user, dataSource } = setup();
    dataSource.createOption.mockImplementationOnce(
      () =>
        new Promise<Option>((r) => {
          resolve = r;
        }),
    );
    await user.type(screen.getByRole("textbox"), "Refunded");
    await user.click(screen.getByRole("option", { name: "Create 'Refunded'" }));
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByTestId("creatable-select-loader")).toBeInTheDocument();
    resolve({ label: "Refunded", value: "refunded" });
    await waitFor(() => expect(screen.queryByTestId("creatable-select-loader")).not.toBeInTheDocument());
  });

  it("a rejected createOption shows the error inline, stays open and does not commit", async () => {
    const { user, props, dataSource } = setup();
    dataSource.createOption.mockRejectedValueOnce(new Error("Option limit reached"));
    await user.type(screen.getByRole("textbox"), "Refunded");
    await user.click(screen.getByRole("option", { name: "Create 'Refunded'" }));
    expect(await screen.findByText(/Option limit reached/)).toBeInTheDocument();
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).not.toBeDisabled();
    expect(await screen.findByRole("option", { name: "Create 'Refunded'" })).toBeInTheDocument();
  });

  it("picking an existing option calls onChange and onCommit with its value", async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole("option", { name: "Pending" }));
    expect(props.onChange).toHaveBeenCalledWith("pending");
    expect(props.onCommit).toHaveBeenCalledWith("pending");
  });

  it("Enter selects the first matching option while searching", async () => {
    const { user, props } = setup();
    await user.type(screen.getByRole("textbox"), "fa{Enter}");
    expect(props.onCommit).toHaveBeenCalledWith("failed");
  });

  it("arrow keys navigate the options", async () => {
    const { user, props } = setup();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(props.onCommit).toHaveBeenCalledWith("pending");
  });

  it("Enter on a new label creates it", async () => {
    const { user, props, dataSource } = setup();
    await user.type(screen.getByRole("textbox"), "Refunded{Enter}");
    await waitFor(() => expect(props.onCommit).toHaveBeenCalledWith("refunded"));
    expect(dataSource.createOption).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels", async () => {
    const { user, props } = setup();
    await user.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("hides the create option when the data source cannot create", async () => {
    const { user } = setup({ dataSource: {} });
    await user.type(screen.getByRole("textbox"), "Refunded");
    expect(screen.queryByText(/Create '/)).not.toBeInTheDocument();
  });

  it("existing options cannot be picked while a create is pending", async () => {
    let resolve: (o: Option) => void = () => {};
    const { user, props, dataSource } = setup();
    dataSource.createOption.mockImplementationOnce(
      () =>
        new Promise<Option>((r) => {
          resolve = r;
        }),
    );
    await user.type(screen.getByRole("textbox"), "Pa");
    await user.click(screen.getByRole("option", { name: "Create 'Pa'" }));
    const paid = screen.queryByRole("option", { name: "Paid" });
    if (paid) fireEvent.click(paid);
    await act(async () => {
      resolve({ label: "Pa", value: "pa" });
    });
    await waitFor(() => expect(props.onCommit).toHaveBeenCalledWith("pa"));
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith("pa");
  });

  it("a double click on the create option calls createOption exactly once", async () => {
    const { user, props, dataSource } = setup();
    await user.type(screen.getByRole("textbox"), "Refunded");
    const create = screen.getByRole("option", { name: "Create 'Refunded'" });
    act(() => {
      fireEvent.click(create);
      fireEvent.click(create);
    });
    await waitFor(() => expect(props.onCommit).toHaveBeenCalledWith("refunded"));
    expect(dataSource.createOption).toHaveBeenCalledTimes(1);
    expect(props.onCommit).toHaveBeenCalledTimes(1);
  });

  it("unmounting during a pending create still reports the created option but does not commit", async () => {
    let resolve: (o: Option) => void = () => {};
    const { user, props, dataSource, unmount } = setup();
    dataSource.createOption.mockImplementationOnce(
      () =>
        new Promise<Option>((r) => {
          resolve = r;
        }),
    );
    await user.type(screen.getByRole("textbox"), "Refunded");
    await user.click(screen.getByRole("option", { name: "Create 'Refunded'" }));
    unmount();
    await act(async () => {
      resolve({ label: "Refunded", value: "refunded" });
    });
    expect(props.onOptionCreate).toHaveBeenCalledWith({ label: "Refunded", value: "refunded" });
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("an existing option whose value is literally '$create' is picked, not created", async () => {
    const options = [...PAYMENT_OPTIONS, { label: "Weird", value: "$create" }];
    const { user, props, dataSource } = setup({ config: { options } });
    await user.click(screen.getByRole("option", { name: "Weird" }));
    expect(dataSource.createOption).not.toHaveBeenCalled();
    expect(props.onCommit).toHaveBeenCalledWith("$create");
  });

  it("shows a value that is not among the options", () => {
    setup({ value: "legacy_stage", autoFocus: false });
    expect(screen.getByRole("textbox")).toHaveValue("legacy_stage");
  });

  it("shows a value that is not among the options as the placeholder in grid mode", () => {
    setup({ value: "legacy_stage" });
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "legacy_stage");
  });

  it("marks the input busy and labels the loader while creating", async () => {
    let resolve: (o: Option) => void = () => {};
    const { user, dataSource } = setup();
    dataSource.createOption.mockImplementationOnce(
      () =>
        new Promise<Option>((r) => {
          resolve = r;
        }),
    );
    await user.type(screen.getByRole("textbox"), "Refunded");
    await user.click(screen.getByRole("option", { name: "Create 'Refunded'" }));
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Creating option")).toBeInTheDocument();
    await act(async () => {
      resolve({ label: "Refunded", value: "refunded" });
    });
  });
});
