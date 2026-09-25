import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createPopupEditor,
  createUiFieldTypeRegistry,
  isPopupEditor,
  resolveEditorComponent,
  type UiEditorProps,
} from "./grid-contracts";

function Dummy(props: UiEditorProps<string>) {
  return <span>dummy:{props.value}</span>;
}

describe("grid-contracts", () => {
  it("createPopupEditor returns a renderable popup-marked editor", () => {
    const popup = createPopupEditor(Dummy);
    expect(popup.cellEditorPopup).toBe(true);
    expect(popup.isPopup).toBe(true);
    expect(isPopupEditor(popup)).toBe(true);
    expect(isPopupEditor(Dummy)).toBe(false);
    const C = popup.component;
    render(
      <C
        value="x"
        onChange={() => {}}
        onCommit={() => {}}
        onCancel={() => {}}
        config={{}}
        column={{ id: "c", key: "c", label: "C", type: "text", config: {}, order: 0, createdAt: "", updatedAt: "" }}
      />,
    );
    expect(screen.getByText("dummy:x")).toBeInTheDocument();
    expect(resolveEditorComponent(popup)).toBe(Dummy);
    expect(resolveEditorComponent(Dummy)).toBe(Dummy);
  });

  it("registry supports register/get/has/list/extend", () => {
    const reg = createUiFieldTypeRegistry();
    reg.register("dummy", { editor: Dummy });
    expect(reg.has("dummy")).toBe(true);
    expect(reg.get("dummy")?.editor).toBe(Dummy);
    expect(reg.list()).toEqual(["dummy"]);
    const Other = () => null;
    const ext = reg.extend({ dummy: { renderer: Other } });
    expect(ext.get("dummy")?.editor).toBe(Dummy);
    expect(ext.get("dummy")?.renderer).toBe(Other);
    expect(reg.get("dummy")?.renderer).toBeUndefined();
  });
});
