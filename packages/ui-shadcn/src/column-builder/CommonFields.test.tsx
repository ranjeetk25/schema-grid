import { screen } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it } from "vitest";
import { type UiEditorProps, extendWithWidgets } from "../internal/grid-contracts";
import { FIXTURE_IDS, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import { CommonFields } from "./CommonFields";
import { type ColumnDraft, columnDraftReducer, createColumnDraft } from "./model";

const schema = buildFixtureSchema();
const registry = buildFixtureRegistry();

function SelectMarker(props: UiEditorProps<string>) {
  return (
    <div data-testid="select-editor">
      select:{props.column.type}:{String(props.autoFocus)}
    </div>
  );
}

function Harness({ initial, onDraft }: { initial: ColumnDraft; onDraft?: (d: ColumnDraft) => void }) {
  const [draft, dispatch] = useReducer(columnDraftReducer, initial);
  onDraft?.(draft);
  const uiRegistry = extendWithWidgets(buildStubUiRegistry(), { select: { editor: SelectMarker, popup: true } });
  return <CommonFields draft={draft} dispatch={dispatch} uiRegistry={uiRegistry} errors={{}} />;
}

const createDraft = (type: string) => columnDraftReducer(createColumnDraft({ schema, registry }), { type: "setType", fieldType: type, registry });
const name = () => screen.getByRole("textbox", { name: /^Name/ });

describe("CommonFields", () => {
  it("auto-slugs the key from the name until the key is edited", async () => {
    let latest: ColumnDraft | undefined;
    const { user } = renderUi(
      <Harness
        initial={createDraft("text")}
        onDraft={(d) => {
          latest = d;
        }}
      />,
    );
    await user.type(name(), "Lead Source");
    expect(screen.getByTestId("column-key")).toHaveTextContent("lead_source");
    expect(screen.queryByRole("textbox", { name: /^Key/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit key" }));
    const key = screen.getByRole("textbox", { name: /^Key/ });
    expect(key).toHaveValue("lead_source");
    await user.clear(key);
    await user.type(key, "src");
    await user.type(name(), "s");
    expect(key).toHaveValue("src");
    expect(latest?.label).toBe("Lead Sources");
  });

  it("locks the key in edit mode", () => {
    renderUi(<Harness initial={createColumnDraft({ schema, registry, column: fixtureColumn(FIXTURE_IDS.payment) })} />);
    expect(screen.getByTestId("column-key")).toHaveTextContent("payment_status");
    expect(screen.queryByRole("button", { name: "Edit key" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^Key/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Key is locked")).toBeInTheDocument();
  });

  it("renders the type's own inline editor for the default value", () => {
    renderUi(<Harness initial={createDraft("select")} />);
    expect(screen.getByTestId("select-editor")).toHaveTextContent("select:select:false");
    expect(screen.getByRole("group", { name: "Default value" })).toBeInTheDocument();
  });

  it("toggles required and indexed", async () => {
    let latest: ColumnDraft | undefined;
    const { user } = renderUi(
      <Harness
        initial={createDraft("text")}
        onDraft={(d) => {
          latest = d;
        }}
      />,
    );
    await user.click(screen.getByRole("switch", { name: "Required" }));
    await user.click(screen.getByRole("switch", { name: /^Indexed/ }));
    expect(latest?.required).toBe(true);
    expect(latest?.indexed).toBe(true);
  });

  it("hides the default value for formula columns", () => {
    renderUi(<Harness initial={createDraft("formula")} />);
    expect(screen.queryByText("Default value")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Required" })).not.toBeInTheDocument();
  });
});
