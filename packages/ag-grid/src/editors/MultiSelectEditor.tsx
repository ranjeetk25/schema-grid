import { useEffect, useRef } from "react";
import type { GridRow } from "../internal/core";
import { createPopupEditor, type PopupEditorInnerProps } from "./createPopupEditor";
import { columnOptions } from "./SelectEditor";
import { parseEditorInput } from "./TextEditor";

function MultiSelectInner(props: PopupEditorInnerProps<GridRow, string[]>): JSX.Element {
  const { schemaColumn, fieldType } = props;
  const options = columnOptions(schemaColumn?.config ?? fieldType?.defaultConfig);
  const selected = new Set(props.value ?? []);
  const listRef = useRef<HTMLFieldSetElement | null>(null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  const toNext = (value: string, checked: boolean): string[] | null => {
    // Keep option order stable regardless of click order.
    const next = options.map((o) => o.id).filter((v) => (v === value ? checked : selected.has(v)));
    const result = parseEditorInput(next, schemaColumn, fieldType);
    const parsed = result.ok ? (result.value as string[] | null) : next;
    return parsed && parsed.length > 0 ? parsed : null;
  };

  return (
    <fieldset
      ref={listRef}
      className="sg-multi-select-editor"
      // Native <fieldset> chrome (border/margin/padding) isn't part of this widget's design; reset it inline
      // rather than in a shared stylesheet, since the group's a11y semantics are local to this editor.
      style={{ border: 0, margin: 0, padding: 0 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.cancel();
        } else if (e.key === "Enter") {
          e.stopPropagation();
          e.preventDefault();
          props.commit(props.value);
        }
      }}
    >
      <legend style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
        {schemaColumn?.label}
      </legend>
      {options.map((o) => (
        <label key={o.id} className="sg-multi-select-option">
          <input className="sg-checkbox" type="checkbox" checked={selected.has(o.id)} onChange={(e) => props.onChange(toNext(o.id, e.target.checked))} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

const multiSelectPopup = createPopupEditor<string[]>(MultiSelectInner, { position: "under" });

/** Popup checkbox-list editor for multiSelect: toggles update the value, Enter commits, Esc cancels. */
export const MultiSelectEditor = multiSelectPopup.component;
