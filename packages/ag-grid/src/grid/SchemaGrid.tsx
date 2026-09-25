/**
 * `<SchemaGrid>`: the renderable component over `useSchemaGrid`.
 *
 * Renders `<div class="sg-root">` (the scope every `SG_CSS` selector hangs
 * off) containing a load-error banner (`role="alert"`, class
 * `sg-load-error`, only while `loadState === "error"`), `AgGridReact` keyed
 * on `rowModelKey` (a row-model switch needs a fresh grid instance) and the
 * `LiveAnnouncer` regions. The theme and the mode's module set come from
 * `gridProps`.
 *
 * Announcements: every applied batch announces `savedMessage(n)` ("Saved" /
 * "Saved N cells") politely, via the `onApplied` seam of `useSchemaGrid`.
 *
 * Generic forwardRef: `forwardRef` erases the `Row` type parameter, so the
 * result is cast to a generic call signature (`SchemaGridComponent`). That
 * keeps `<SchemaGrid<MyRow> ref={handleRef} ... />` fully typed; the cast is
 * sound because the inner render function is itself generic over `Row`.
 */
import type { GridApi } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  type ReactElement,
  type Ref,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { createAnnouncer, type Politeness, savedMessage } from "../a11y/announcer";
import { LiveAnnouncer } from "../a11y/LiveAnnouncer";
import type { AppliedInfo } from "../editing/editController";
import { FullWidthRowRenderer } from "../grouping/GroupRowRenderer";
import type { GridRow, ViewDef } from "../internal/core";
import { wrapWithCellShell } from "../range/CellShell";
import { RANGE_CELL_CLASS_RULES } from "../range/useRangeSelection";
import { SG_CLASSES } from "../theme/classNames";
import type { SchemaGridStores } from "./gridContext";
import {
  type ExportFormat,
  type SchemaGridProps,
  type UseSchemaGridSeams,
  useSchemaGrid,
} from "./useSchemaGrid";

export interface SchemaGridComponentProps<Row extends GridRow = GridRow> extends SchemaGridProps<Row> {
  /** Extra class(es) on the `sg-root` element. */
  className?: string;
  /** Merged over the root's own style (`height`, `width: 100%`). */
  style?: CSSProperties;
  /** Root height. Default "100%". */
  height?: CSSProperties["height"];
}

export interface SchemaGridHandle<Row extends GridRow = GridRow> {
  api(): GridApi<Row> | null;
  undo(): Promise<void>;
  redo(): Promise<void>;
  canUndo(): boolean;
  canRedo(): boolean;
  exportCsv(fileName?: string): void;
  exportCurrentView(format: ExportFormat, fileName?: string): Promise<Blob | string | ArrayBuffer | Uint8Array>;
  captureView(): ViewDef | null;
  refetch(): Promise<void>;
  stores: SchemaGridStores<Row>;
  announce(message: string, politeness?: Politeness): void;
}

export type SchemaGridComponent = <Row extends GridRow = GridRow>(
  props: SchemaGridComponentProps<Row> & { ref?: Ref<SchemaGridHandle<Row>> },
) => ReactElement | null;

const ROOT_LAYOUT: CSSProperties = { position: "relative", display: "flex", flexDirection: "column", width: "100%" };
const GRID_WRAPPER: CSSProperties = { flex: "1 1 auto", minHeight: 0 };

function errorText(error: unknown, external: boolean): string {
  if (external) return "The grid's filter is invalid, so no rows are shown.";
  const detail = error instanceof Error && error.message ? `: ${error.message}` : ".";
  return `Couldn't load rows${detail}`;
}

function SchemaGridInner<Row extends GridRow = GridRow>(
  props: SchemaGridComponentProps<Row>,
  ref: ForwardedRef<SchemaGridHandle<Row>>,
) {
  const { className, style, height = "100%", ...gridPropsIn } = props;
  const [announcer] = useState(createAnnouncer);
  const announce = useCallback(
    (message: string, politeness?: Politeness) => announcer.announce(message, politeness),
    [announcer],
  );
  const onApplied = useCallback(
    (info: AppliedInfo<Row>) => {
      const n = info.changedCells.length;
      if (n > 0) announcer.announce(savedMessage(n), "polite");
    },
    [announcer],
  );
  const seams = useMemo<UseSchemaGridSeams<Row>>(
    () => ({
      announce,
      onApplied,
      fullWidthCellRenderer: FullWidthRowRenderer,
      wrapRenderer: wrapWithCellShell,
      cellClassRules: RANGE_CELL_CLASS_RULES,
    }),
    [announce, onApplied],
  );
  const grid = useSchemaGrid<Row>(gridPropsIn, seams);

  useImperativeHandle(
    ref,
    (): SchemaGridHandle<Row> => ({
      api: grid.api,
      undo: grid.undo.undo,
      redo: grid.undo.redo,
      canUndo: grid.undo.canUndo,
      canRedo: grid.undo.canRedo,
      exportCsv: grid.exportCsv,
      exportCurrentView: grid.exportCurrentView,
      captureView: grid.captureView,
      refetch: grid.refetch,
      stores: grid.stores,
      announce,
    }),
    [
      grid.api,
      grid.undo,
      grid.exportCsv,
      grid.exportCurrentView,
      grid.captureView,
      grid.refetch,
      grid.stores,
      announce,
    ],
  );

  const rootClass = className ? `${SG_CLASSES.root} ${className}` : SG_CLASSES.root;
  const rootStyle = useMemo<CSSProperties>(() => ({ ...ROOT_LAYOUT, height, ...style }), [height, style]);

  return (
    <div
      ref={grid.clipboard.rootRef}
      className={rootClass}
      style={rootStyle}
      onKeyDown={grid.keyboard.handleRootKeyDown}
      onCopy={grid.clipboard.onCopy}
      onPaste={grid.clipboard.onPaste}
    >
      {grid.loadState === "error" ? (
        <div role="alert" className="sg-load-error">
          {errorText(grid.lastError, grid.filterErrors.external.length > 0)}
        </div>
      ) : null}
      <div className="sg-grid-wrapper" style={GRID_WRAPPER}>
        <AgGridReact<Row> key={grid.rowModelKey} {...grid.gridProps} />
      </div>
      <LiveAnnouncer announcer={announcer} />
    </div>
  );
}

/** The schema-driven grid. See the file header for the generic `forwardRef` cast. */
export const SchemaGrid = forwardRef(SchemaGridInner) as unknown as SchemaGridComponent;
(SchemaGrid as { displayName?: string }).displayName = "SchemaGrid";
