import { screen } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it } from "vitest";
import type { UiEditorProps } from "../internal/grid-contracts";
import { createPopupEditor } from "../internal/grid-contracts";
import { buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry, fixtureColumn, FIXTURE_IDS } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { CommonFields } from "./CommonFields";
import { type ColumnDraft, columnDraftReducer, createColumnDraft } from "./model";

const schema = buildFixtureSchema();
const registry = buildFixtureRegistry();

function SelectMarker(props: UiEditorProps<string>) {
  return <div data-testid="select-editor">select:{props.column.type}:{String(props.autoFocus)}</div>;
}

function Harness({ initial, onDraft }: { initial: ColumnDraft; onDraft?: (d: ColumnDraft) => void }) {
  const [draft, dispatch] = useReducer(columnDraftReducer, initial);
  onDraft?.(draft);
  const uiRegistry = buildStubUiRegistry().extend({ select: { editor: createPopupEditor(SelectMarker) } });
  return <CommonFields draft={draft} dispatch={dispatch} uiRegistry={uiRegistry} errors={{}} />;
}

const createDraft = (type: string) =>
  columnDraftReducer(createColumnDraft({ schema, registry }), { type: "setType", fieldType: type, registry });

describe("CommonFields", () => {
  it("auto-slugs the key from the label until the key is edited", async () => {
    let latest: ColumnDraft | undefined;
    const { user } = renderWithMantine(<Harness initial={createDraft("text")} onDraft={(d) => (latest = d)} />);
    await user.type(screen.getByRole("textbox", { name: /^Label/ }), "Lead Source");
    expect(screen.getByRole("textbox", { name: /^Key/ })).toHaveValue("lead_source");
    await user.clear(screen.getByRole("textbox", { name: /^Key/ }));
    await user.type(screen.getByRole("textbox", { name: /^Key/ }), "src");
    await user.type(screen.getByRole("textbox", { name: /^Label/ }), "s");
    expect(screen.getByRole("textbox", { name: /^Key/ })).toHaveValue("src");
    expect(latest?.label).toBe("Lead Sources");
  });

  it("disables the key input in edit mode", () => {
    renderWithMantine(<Harness initial={createColumnDraft({ schema, registry, column: fixtureColumn(FIXTURE_IDS.payment) })} />);
    expect(screen.getByRole("textbox", { name: /^Key/ })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /^Key/ })).toHaveValue("payment_status");
  });

  it("renders the type's own inline editor for the default value", () => {
    renderWithMantine(<Harness initial={createDraft("select")} />);
    expect(screen.getByTestId("select-editor")).toHaveTextContent("select:select:false");
  });

  it("toggles required and indexed", async () => {
    let latest: ColumnDraft | undefined;
    const { user } = renderWithMantine(<Harness initial={createDraft("text")} onDraft={(d) => (latest = d)} />);
    await user.click(screen.getByRole("switch", { name: "Required" }));
    await user.click(screen.getByRole("switch", { name: /^Indexed/ }));
    expect(latest?.required).toBe(true);
    expect(latest?.indexed).toBe(true);
  });

  it("hides the default value for formula columns", () => {
    renderWithMantine(<Harness initial={createDraft("formula")} />);
    expect(screen.queryByText("Default value")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Required" })).not.toBeInTheDocument();
  });
});
