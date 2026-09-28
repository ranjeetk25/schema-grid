/**
 * v0.4.1: pickers gate on the source's capabilities, not on whether a data
 * source method exists. Without `lookup` the link picker (without `options`
 * the user picker) shows why instead of calling; without `options` there is
 * no "Create" entry and dynamic selects keep their static options.
 */
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../internal/core-contracts";
import { FIXTURE_IDS, FIXTURE_NOW, PAYMENT_OPTIONS, buildStubDataSource, fixtureColumn } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { CreatableSelectEditor } from "./CreatableSelectEditor";
import { LinkPickerEditor } from "./LinkPickerEditor";
import { SelectEditor } from "./SelectEditor";
import { UserPickerEditor } from "./UserPickerEditor";

const handlers = () => ({ onChange: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn() });
const column = (type: string, config: unknown = {}): ColumnDef => ({
  id: `col_${type}`,
  key: type,
  label: type,
  type,
  config,
  order: 0,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
});

describe("LinkPickerEditor", () => {
  it("without capabilities.lookup shows the reason and never calls lookup", () => {
    const dataSource = buildStubDataSource();
    const c = column("link", { multiple: false });
    renderWithMantine(
      <LinkPickerEditor
        {...handlers()}
        value={{ id: "r_1", label: "Lead #1" }}
        column={c}
        config={c.config}
        dataSource={dataSource}
        capabilities={{ lookup: false }}
      />,
    );
    expect(screen.getByText("Linking isn't set up for this grid")).toBeInTheDocument();
    expect(screen.getByText("Lead #1")).toBeInTheDocument();
    expect(dataSource.lookup).not.toHaveBeenCalled();
  });

  it("with capabilities.lookup it searches as before", async () => {
    const dataSource = buildStubDataSource();
    const c = column("link");
    renderWithMantine(
      <LinkPickerEditor {...handlers()} value={null} column={c} config={c.config} dataSource={dataSource} capabilities={{ lookup: true }} />,
    );
    await waitFor(() => expect(dataSource.lookup).toHaveBeenCalled());
  });
});

describe("UserPickerEditor", () => {
  it("without capabilities.options shows the reason and never calls getOptions", () => {
    const dataSource = buildStubDataSource();
    const c = fixtureColumn(FIXTURE_IDS.owner);
    renderWithMantine(
      <UserPickerEditor
        {...handlers()}
        value={{ id: "u_asha", name: "Asha Rao" }}
        column={c}
        config={c.config}
        dataSource={dataSource}
        capabilities={{ options: false }}
      />,
    );
    expect(screen.getByText("People search isn't set up for this grid")).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(dataSource.getOptions).not.toHaveBeenCalled();
  });
});

describe("CreatableSelectEditor", () => {
  it("without capabilities.options shows the reason instead of a Create entry", async () => {
    const dataSource = buildStubDataSource();
    const c = column("creatableSelect", { options: PAYMENT_OPTIONS });
    const { user } = renderWithMantine(
      <CreatableSelectEditor
        {...handlers()}
        value={null}
        column={c}
        config={c.config}
        dataSource={dataSource}
        capabilities={{ options: false }}
      />,
    );
    await user.type(screen.getByRole("textbox"), "Refunded");
    expect(screen.queryByText(/Create '/)).toBeNull();
    expect(screen.queryByRole("option", { name: /Create/ })).toBeNull();
    expect(screen.getByText("Creating options isn't set up for this grid")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(dataSource.createOption).not.toHaveBeenCalled();
    // Existing options still pick.
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Paid");
    expect(screen.getByRole("option", { name: "Paid" })).toBeInTheDocument();
  });
});

describe("SelectEditor (dynamic)", () => {
  it("without capabilities.options keeps the static options and never calls getOptions", async () => {
    const dataSource = buildStubDataSource();
    const c = column("select", { options: PAYMENT_OPTIONS, dynamic: true });
    const { user } = renderWithMantine(
      <SelectEditor
        {...handlers()}
        value={null}
        column={c}
        config={c.config as never}
        dataSource={dataSource}
        capabilities={{ options: false }}
        autoFocus={false}
      />,
    );
    await user.click(screen.getByRole("textbox"));
    expect(await screen.findByRole("option", { name: /Paid/ })).toBeInTheDocument();
    expect(dataSource.getOptions).not.toHaveBeenCalled();
  });

  it("with options it fetches the dynamic list", async () => {
    const dataSource = buildStubDataSource();
    const c = column("select", { options: PAYMENT_OPTIONS, dynamic: true });
    renderWithMantine(
      <SelectEditor {...handlers()} value={null} column={c} config={c.config as never} dataSource={dataSource} autoFocus={false} />,
    );
    await waitFor(() => expect(dataSource.getOptions).toHaveBeenCalledWith(c.id));
  });
});
