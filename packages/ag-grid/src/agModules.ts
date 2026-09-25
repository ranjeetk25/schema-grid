import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  ColumnApiModule,
  CsvExportModule,
  CustomEditorModule,
  CustomFilterModule,
  EventApiModule,
  HighlightChangesModule,
  InfiniteRowModelModule,
  type Module,
  RenderApiModule,
  RowApiModule,
  RowSelectionModule,
  RowStyleModule,
  ScrollApiModule,
  TextEditorModule,
} from "ag-grid-community";

/**
 * Community-only module set, passed per grid via the `modules` prop (never the
 * global registry). Verified present in ag-grid-community 36.2.
 * Deliberately excluded: UndoRedoEditModule (we own undo), Text/Number/Date
 * filter modules (our filters are custom), anything Enterprise.
 */
const SHARED_MODULES: readonly Module[] = [
  CustomEditorModule,
  CustomFilterModule,
  CellStyleModule,
  RowStyleModule,
  RowApiModule,
  RenderApiModule,
  HighlightChangesModule,
  CsvExportModule,
  ColumnApiModule,
  EventApiModule,
  RowSelectionModule,
  TextEditorModule,
  ScrollApiModule,
];

export const SCHEMA_GRID_CLIENT_MODULES: readonly Module[] = [
  ...SHARED_MODULES,
  ClientSideRowModelModule,
  ClientSideRowModelApiModule,
];

export const SCHEMA_GRID_INFINITE_MODULES: readonly Module[] = [...SHARED_MODULES, InfiniteRowModelModule];
