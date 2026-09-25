import { useEffect, useRef } from "react";
import type { GridRow } from "../internal/core";
import { createPopupEditor, type PopupEditorInnerProps } from "./createPopupEditor";
import { columnOptions } from "./SelectEditor";
import { parseEditorInput } from "./TextEditor";

function MultiSelectInner(props: PopupEditorInnerProps<GridRow, string[]>): JSX.Element {
  const { schemaColumn, fieldType } = props;
  const options = columnOptions(schemaColumn?.config ?? fieldType?.defaultConfig);
  const selected = new Set(props.value ?? []);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  const toNext = (value: string, checked: boolean): string[] | null => {
    // Keep option order stable regardless of click order.
    const next = options.map((o) => o.value).filter((v) => (v === value ? checked : selected.has(v)));
    const result = parseEditorInput(next, schemaColumn, fieldType);
    const parsed = result.ok ? (result.value as string[] | null) : next;
    return parsed && parsed.length > 0 ? parsed : null;
  };

  return (
    <div
      ref={listRef}
      className="sg-multi-select-editor"
      role="group"
      aria-label={schemaColumn?.label}
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
      {options.map((o) => (
        <label key={o.value} className="sg-multi-select-option">
          <input type="checkbox" checked={selected.has(o.value)} onChange={(e) => props.onChange(toNext(o.value, e.target.checked))} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

const multiSelectPopup = createPopupEditor<string[]>(MultiSelectInner, { position: "under" });

/** Popup checkbox-list editor for multiSelect: toggles update the value, Enter commits, Esc cancels. */
export const MultiSelectEditor = multiSelectPopup.component;
