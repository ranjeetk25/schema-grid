import type { ComponentType } from "react";
import type { CustomCellEditorProps } from "ag-grid-react";
import type { UiEditorEntry } from "../compile/uiRegistry";
import type { FieldTypeId, GridRow } from "../internal/core";
import { BooleanEditor } from "./BooleanEditor";
import { DateEditor } from "./DateEditor";
import { LongTextEditor } from "./LongTextEditor";
import { MultiSelectEditor } from "./MultiSelectEditor";
import { NumberEditor } from "./NumberEditor";
import { SelectEditor } from "./SelectEditor";
import { TextEditor } from "./TextEditor";

type Editor = ComponentType<CustomCellEditorProps<GridRow>>;

const inline = (editor: Editor): UiEditorEntry => ({ editor, editorPopup: false });

/**
 * Per-type default editors. creatableSelect/user/link are filled in by T18's
 * ComboboxEditor; formula columns are never editable, so they have none.
 */
export const DEFAULT_EDITORS: Partial<Record<FieldTypeId, UiEditorEntry>> = {
  text: inline(TextEditor),
  url: inline(TextEditor),
  email: inline(TextEditor),
  phone: inline(TextEditor),
  longText: { editor: LongTextEditor, editorPopup: true, editorPopupPosition: "under" },
  number: inline(NumberEditor),
  currency: inline(NumberEditor),
  boolean: inline(BooleanEditor),
  date: inline(DateEditor),
  datetime: inline(DateEditor),
  select: inline(SelectEditor),
  multiSelect: { editor: MultiSelectEditor, editorPopup: true, editorPopupPosition: "under" },
};
