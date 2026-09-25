import { type ComponentType, useCallback, useEffect, useRef, useState } from "react";
import { type CustomCellEditorProps, useGridCellEditor } from "ag-grid-react";
import type { ColumnDef, FieldType, GridRow } from "../internal/core";

/** AG Grid's marker class: mousedowns inside an element carrying it don't close a (modal) popup editor. */
const CUSTOM_POPUP_CLASS = "ag-custom-component-popup";

/** Props the component wrapped by `createPopupEditor` receives. */
export interface PopupEditorInnerProps<Row extends GridRow = GridRow, TValue = unknown> {
  /** The editor's current value (starts at the cell value). */
  value: TValue | null;
  /** Update the value without closing the editor. */
  onChange(value: TValue | null): void;
  /** Report `value` and stop editing (the grid commits it). */
  commit(value: TValue | null): void;
  /** Stop editing and discard any change. */
  cancel(): void;
  /** The schema column being edited (from `cellEditorParams`; set by `compileColumns`). */
  schemaColumn: ColumnDef | undefined;
  /** The column's core field type (from `cellEditorParams`). */
  fieldType: FieldType<unknown, unknown> | undefined;
  /** AG Grid's raw editor props, for anything else (eventKey, api, node, ...). */
  editorProps: CustomCellEditorProps<Row>;
}

export interface CreatePopupEditorOptions {
  /**
   * Keep the popup open when the user mouses down outside it. AG Grid only
   * closes popup editors on outside mousedown when the grid option
   * `stopEditingWhenCellsLoseFocus` is true (the popup is then "modal"); there
   * is no per-editor switch. When this is true, the editor tags the target of
   * every outside mousedown with AG Grid's `ag-custom-component-popup` class
   * for the duration of that event, which AG Grid treats as "inside the
   * popup". Clicking another grid cell still moves focus and ends the edit.
   */
  keepOpenOnOutsideClick?: boolean;
  /** Where AG Grid places the popup relative to the cell. Default "over". */
  position?: "over" | "under";
}

export interface PopupEditorEntry<Row extends GridRow = GridRow> {
  component: ComponentType<CustomCellEditorProps<Row>>;
  cellEditorPopup: true;
  cellEditorPopupPosition: "over" | "under";
}

type SchemaEditorExtras = { schemaColumn?: ColumnDef; fieldType?: FieldType<unknown, unknown> };

/**
 * Wraps a component as an AG Grid popup cell editor.
 *
 * - `commit(v)` → `onValueChange(v)` then `props.stopEditing()` (a normal,
 *   non-cancelling stop: AG Grid's `ICellEditorParams.stopEditing` has no cancel
 *   argument — its boolean is `suppressNavigateAfterEdit`).
 * - `cancel()` → reports the original value, makes `isCancelAfterEnd` return
 *   true, and calls `props.api.stopEditing(true)` (the grid API's cancel flag).
 * - Focus: the container has `tabIndex={-1}` and focuses itself on mount unless
 *   the inner component already focused something inside it. If focus escapes
 *   to nowhere (body) or to something outside both the popup and the grid (and
 *   not inside an `ag-custom-component-popup` element), focus is pulled back.
 * - Keyboard: AG Grid forwards keydowns from popup editors to the grid, so
 *   Enter/Tab/Esc behave as for inline editors. An inner component that needs
 *   its own Enter should call `event.stopPropagation()` (and/or wire a
 *   `suppressKeyboardEvent`, see `longTextSuppressKeyboardEvent`).
 *
 * Mantine (or any portal-based) dropdowns inside the popup must render inside
 * it — `withinPortal={false}` / `comboboxProps={{ withinPortal: false }}` — or
 * carry the `ag-custom-component-popup` class, so AG Grid doesn't treat clicks
 * in them as outside clicks.
 */
export function createPopupEditor<TValue = unknown, Row extends GridRow = GridRow, P extends object = object>(
  Component: ComponentType<PopupEditorInnerProps<Row, TValue> & P>,
  opts: CreatePopupEditorOptions = {},
): PopupEditorEntry<Row> {
  const { keepOpenOnOutsideClick = false, position = "over" } = opts;

  function PopupEditor(editorProps: CustomCellEditorProps<Row>): JSX.Element {
    const { schemaColumn, fieldType } = editorProps as CustomCellEditorProps<Row> & SchemaEditorExtras;
    const [value, setValue] = useState<TValue | null>(() => (editorProps.value ?? null) as TValue | null);
    const cancelledRef = useRef(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const propsRef = useRef(editorProps);
    propsRef.current = editorProps;

    useGridCellEditor({ isCancelAfterEnd: () => cancelledRef.current });

    const onChange = useCallback((next: TValue | null): void => {
      setValue(next);
      propsRef.current.onValueChange(next);
    }, []);

    const commit = useCallback((next: TValue | null): void => {
      setValue(next);
      cancelledRef.current = false;
      propsRef.current.onValueChange(next);
      propsRef.current.stopEditing();
    }, []);

    const cancel = useCallback((): void => {
      cancelledRef.current = true;
      const p = propsRef.current;
      p.onValueChange(p.initialValue);
      p.api.stopEditing(true);
    }, []);

    // Focus on mount (unless the inner component already focused a child).
    useEffect(() => {
      const el = containerRef.current;
      if (el && !el.contains(document.activeElement)) el.focus();
    }, []);

    // Pull focus back if it escapes to nowhere or outside both popup and grid.
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      let mounted = true;
      const refocusSoon = (): void => {
        setTimeout(() => {
          if (!mounted) return;
          const active = document.activeElement;
          if (!active || active === document.body) el.focus();
        }, 0);
      };
      const onFocusOut = (event: FocusEvent): void => {
        if (event.relatedTarget === null) refocusSoon();
      };
      const onFocusIn = (event: FocusEvent): void => {
        const target = event.target;
        if (!(target instanceof Element) || el.contains(target)) return;
        if (target.closest(".ag-root-wrapper") || target.closest(`.${CUSTOM_POPUP_CLASS}`)) return;
        el.focus();
      };
      el.addEventListener("focusout", onFocusOut);
      document.addEventListener("focusin", onFocusIn);
      return () => {
        mounted = false;
        el.removeEventListener("focusout", onFocusOut);
        document.removeEventListener("focusin", onFocusIn);
      };
    }, []);

    // keepOpenOnOutsideClick: tag outside mousedown targets as custom popup content for that event only.
    useEffect(() => {
      if (!keepOpenOnOutsideClick) return;
      const onMouseDown = (event: MouseEvent): void => {
        const target = event.target;
        const el = containerRef.current;
        if (!(target instanceof Element) || !el || el.contains(target)) return;
        if (target.classList.contains(CUSTOM_POPUP_CLASS)) return;
        target.classList.add(CUSTOM_POPUP_CLASS);
        setTimeout(() => target.classList.remove(CUSTOM_POPUP_CLASS), 0);
      };
      window.addEventListener("mousedown", onMouseDown, true);
      return () => window.removeEventListener("mousedown", onMouseDown, true);
    }, []);

    const innerProps = {
      ...(editorProps as unknown as P),
      value,
      onChange,
      commit,
      cancel,
      schemaColumn,
      fieldType,
      editorProps,
    } as PopupEditorInnerProps<Row, TValue> & P;

    return (
      <div ref={containerRef} className="sg-popup-editor" tabIndex={-1}>
        <Component {...innerProps} />
      </div>
    );
  }
  PopupEditor.displayName = `PopupEditor(${Component.displayName ?? Component.name ?? "Component"})`;

  return { component: PopupEditor, cellEditorPopup: true, cellEditorPopupPosition: position };
}
