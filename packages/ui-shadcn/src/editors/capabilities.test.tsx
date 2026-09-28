/** v0.4.1 capability-gated pickers: gate on `capabilities`, not on whether the data source has the method. */
import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../internal/core-contracts";
import { FIXTURE_IDS, FIXTURE_NOW, PAYMENT_OPTIONS, buildStubDataSource, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import { CreatableSelectEditor } from "./CreatableSelectEditor";
import { LinkPickerEditor } from "./LinkPickerEditor";
import { SelectEditor } from "./SelectEditor";
import { UserPickerEditor } from "./UserPickerEditor";

const handlers = () => ({ onChange: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn() });

const linkColumn: ColumnDef = {
  id: "col_lead",
  key: "lead",
  label: "Lead",
  type: "link",
  config: { target: "leads", multiple: false },
  order: 0,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
};

const stageColumn: ColumnDef = {
  id: "col_stage",
  key: "stage",
  label: "Stage",
  type: "creatableSelect",
  config: { options: PAYMENT_OPTIONS },
  order: 0,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("LinkPickerEditor without capabilities.lookup", () => {
  it("shows why instead of calling lookup, even though the data source has one", async () => {
    const dataSource = buildStubDataSource();
    renderUi(
      <LinkPickerEditor
        {...handlers()}
        value={[{ id: "l1", label: "Lead #1" }]}
        column={linkColumn}
        config={linkColumn.config}
        dataSource={dataSource}
        capabilities={{ lookup: false, options: true }}
      />,
    );
    await flush();
    expect(screen.getByText("Linking isn't set up for this grid")).toBeInTheDocument();
    expect(screen.getByText("Lead #1")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(dataSource.lookup).not.toHaveBeenCalled();
  });

  it("calls lookup when the capabilities allow it", async () => {
    const dataSource = buildStubDataSource();
    renderUi(
      <LinkPickerEditor {...handlers()} value={null} column={linkColumn} config={linkColumn.config} dataSource={dataSource} capabilities={{ lookup: true }} />,
    );
    await waitFor(() => expect(dataSource.lookup).toHaveBeenCalled());
  });
});

describe("UserPickerEditor without capabilities.options", () => {
  it("shows why instead of calling getOptions", async () => {
    const dataSource = buildStubDataSource();
    const column = fixtureColumn(FIXTURE_IDS.owner);
    renderUi(
      <UserPickerEditor
        {...handlers()}
        value={{ id: "u1", name: "Asha Rao" }}
        column={column}
        config={column.config}
        dataSource={dataSource}
        capabilities={{ options: false }}
      />,
    );
    await flush();
    expect(screen.getByText("People search isn't set up for this grid")).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(dataSource.getOptions).not.toHaveBeenCalled();
  });
});

describe("CreatableSelectEditor without capabilities.options", () => {
  it("offers no “Create” entry and says why, even though the data source has createOption", async () => {
    const dataSource = buildStubDataSource();
    const { user } = renderUi(
      <CreatableSelectEditor
        {...handlers()}
        value={null}
        column={stageColumn}
        config={stageColumn.config}
        dataSource={dataSource}
        capabilities={{ options: false }}
      />,
    );
    await user.type(screen.getByRole("combobox"), "Brand new");
    expect(screen.queryByRole("option", { name: /Create/ })).toBeNull();
    expect(screen.getByText("Creating options isn't set up for this grid")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(dataSource.createOption).not.toHaveBeenCalled();
  });
});

describe("dynamic select options without capabilities.options", () => {
  it("keeps the static options and never calls getOptions", async () => {
    const dataSource = buildStubDataSource();
    const column = fixtureColumn(FIXTURE_IDS.payment);
    renderUi(
      <SelectEditor
        {...handlers()}
        value={null}
        column={column}
        config={{ ...(column.config as object), dynamic: true }}
        dataSource={dataSource}
        capabilities={{ options: false }}
      />,
    );
    await flush();
    expect(screen.getByRole("option", { name: "Paid" })).toBeInTheDocument();
    expect(dataSource.getOptions).not.toHaveBeenCalled();
  });
});
