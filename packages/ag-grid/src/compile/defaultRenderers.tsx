import type { CustomCellRendererProps } from "ag-grid-react";
import type { ColumnDef, FieldType, GridRow, Option } from "../internal/core";
import { isFormulaError } from "../internal/core";

/**
 * Extra params `compileColumns` (T6) puts into `colDef.cellRendererParams`. AG
 * Grid merges `cellRendererParams` directly onto the props object handed to a
 * custom cell renderer, so a renderer reads these alongside `props.value`.
 *
 * DEVIATION from the plan's literal field name: `ICellRendererParams` already
 * has its own `column: Column<any>` (the ag-grid column model object), so our
 * schema `ColumnDef` is exposed as `schemaColumn` instead of `column` to avoid
 * a name collision/type conflict when merged onto the renderer's props.
 */
export interface SchemaCellRendererParams {
  schemaColumn: ColumnDef;
  fieldType: FieldType<unknown, unknown> | undefined;
}

/**
 * Loosest renderer prop shape we actually read: ag-grid's cell params plus
 * the schema extras above, under `schemaColumn`/`fieldType` — `column` itself
 * is already ag-grid's own `Column` object on `ICellRendererParams`, so the
 * schema column can't reuse that name.
 */
export type SchemaRendererProps<Row extends GridRow = GridRow> = CustomCellRendererProps<Row> & {
  schemaColumn?: ColumnDef;
  fieldType?: FieldType<unknown, unknown>;
};

function getSchemaParams<Row extends GridRow>(props: SchemaRendererProps<Row>): { column: ColumnDef | undefined; fieldType: FieldType<unknown, unknown> | undefined } {
  return { column: props.schemaColumn, fieldType: props.fieldType };
}

function multiSelectOptions(column: ColumnDef | undefined): Option[] {
  const config = column?.config as { options?: Option[] } | undefined;
  return config?.options ?? [];
}

/** Default renderer for text-like and other "just format it" field types. Also renders formula errors. */
export function TextRenderer<Row extends GridRow = GridRow>(props: SchemaRendererProps<Row>): JSX.Element {
  if (isFormulaError(props.value)) {
    return (
      <span className="sg-cell-error" title={props.value.message}>
        #ERROR
      </span>
    );
  }
  const { column, fieldType } = getSchemaParams(props);
  if (!fieldType) return <>{props.value == null ? "" : String(props.value)}</>;
  const config = column?.config ?? fieldType.defaultConfig;
  return <>{fieldType.format(props.value as never, config as never)}</>;
}

/** Read-only checkbox — boolean columns are edited through the boolean editor, never inline in the renderer. */
export function BooleanRenderer<Row extends GridRow = GridRow>(props: SchemaRendererProps<Row>): JSX.Element {
  const checked = props.value === true;
  return <input type="checkbox" readOnly disabled checked={checked} aria-label={checked ? "Checked" : "Unchecked"} />;
}

function toHref(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export function UrlRenderer<Row extends GridRow = GridRow>(props: SchemaRendererProps<Row>): JSX.Element | null {
  const value = props.value;
  if (value == null || value === "") return null;
  const text = String(value);
  return (
    <a href={toHref(text)} target="_blank" rel="noreferrer noopener">
      {text}
    </a>
  );
}

export function EmailRenderer<Row extends GridRow = GridRow>(props: SchemaRendererProps<Row>): JSX.Element | null {
  const value = props.value;
  if (value == null || value === "") return null;
  const text = String(value);
  return <a href={`mailto:${text}`}>{text}</a>;
}

export function MultiSelectRenderer<Row extends GridRow = GridRow>(props: SchemaRendererProps<Row>): JSX.Element {
  const { column } = getSchemaParams(props);
  const options = multiSelectOptions(column);
  const values = Array.isArray(props.value) ? (props.value as unknown[]).map(String) : [];
  return (
    <>
      {values.map((v) => {
        const label = options.find((o) => o.value === v)?.label ?? v;
        return (
          <span className="sg-chip" key={v}>
            {label}
          </span>
        );
      })}
    </>
  );
}

/**
 * Map of built-in field type id -> default renderer component. Cast to the
 * caller's `Row` in `uiRegistry.ts`: these renderers only read
 * `props.value`/`props.column`/`props.fieldType`, so they're safe for any Row shape.
 */
export const DEFAULT_RENDERER_COMPONENTS = {
  text: TextRenderer,
  longText: TextRenderer,
  number: TextRenderer,
  currency: TextRenderer,
  boolean: BooleanRenderer,
  date: TextRenderer,
  datetime: TextRenderer,
  select: TextRenderer,
  multiSelect: MultiSelectRenderer,
  creatableSelect: TextRenderer,
  user: TextRenderer,
  url: UrlRenderer,
  email: EmailRenderer,
  phone: TextRenderer,
  link: TextRenderer,
  formula: TextRenderer,
} as const;
