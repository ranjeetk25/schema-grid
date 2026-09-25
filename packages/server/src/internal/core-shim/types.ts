/**
 * TEMPORARY local copies of the @masai/schema-grid-core §4 contract types.
 * Core is being built concurrently; every name here is re-exported through
 * `src/internal/core.ts` with a `TODO(core)` marker. When core publishes these
 * names, delete this directory and re-export from `@masai/schema-grid-core`.
 *
 * Shapes follow spec §4 and docs/superpowers/plans/2026-09-25-core.md Task 2.
 */
import type { ZodType } from "zod";

// ---- common ---------------------------------------------------------------
export interface ActorRef {
  id: string;
  name?: string;
}
export interface Option {
  id: string;
  label: string;
  color?: string;
}
export interface LinkRef {
  id: string;
  label: string;
}
export interface UserRef {
  id: string;
  name?: string;
}
export type ISODateString = string;
export type ISODateTimeString = string;

// ---- field type ids -------------------------------------------------------
export const BUILTIN_FIELD_TYPE_IDS = [
  "text",
  "longText",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "select",
  "multiSelect",
  "creatableSelect",
  "user",
  "url",
  "email",
  "phone",
  "link",
  "formula",
] as const;
export type BuiltinFieldTypeId = (typeof BUILTIN_FIELD_TYPE_IDS)[number];
export type FieldTypeId = BuiltinFieldTypeId | (string & {});

// ---- schema ---------------------------------------------------------------
export type RoleRule = "all" | { roles: string[] };
export interface ColumnPermissions {
  read: RoleRule;
  edit: RoleRule;
}
export interface ColumnValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  message?: string;
}
export interface ColumnDef {
  id: string;
  key: string;
  label: string;
  type: FieldTypeId;
  config: unknown;
  required?: boolean;
  defaultValue?: unknown;
  validation?: ColumnValidation;
  permissions?: ColumnPermissions;
  width?: number;
  pinned?: "left" | "right" | null;
  hidden?: boolean;
  order: number;
  indexed?: boolean;
  formula?: string;
  source?: { valueField: string };
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}
export interface ColumnState {
  id: string;
  hidden: boolean;
  width: number;
  pinned: "left" | "right" | null;
  order: number;
}
export interface ViewDef {
  id: string;
  name: string;
  filter: FilterNode | null;
  sort: SortSpec[];
  search?: string;
  columnState: ColumnState[];
  groupBy: GroupSpec[];
  pageSize: number;
}
export interface GridSchema {
  id: string;
  schemaVersion: number;
  columns: ColumnDef[];
  views?: ViewDef[];
}

// ---- filter ---------------------------------------------------------------
export type FilterPrimitive = string | number | boolean | null;
export type RelativeDateKind =
  | "today"
  | "yesterday"
  | "tomorrow"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "lastNDays"
  | "nextNDays";
export interface RelativeDate {
  relative: RelativeDateKind;
  n?: number;
}
export interface DateRange {
  from: string;
  to: string;
}
export type FilterValue =
  | FilterPrimitive
  | FilterPrimitive[]
  | { from: FilterPrimitive; to: FilterPrimitive }
  | RelativeDate
  | { me: true };
export interface FilterCondition {
  columnId: string;
  operator: string;
  value?: FilterValue;
}
export interface FilterGroup {
  op: "and" | "or";
  children: FilterNode[];
}
export type FilterNode = FilterGroup | FilterCondition;

export type FilterValueKind = "none" | "single" | "multi" | "range" | "relativeDate" | "me";
export interface FilterOperatorDef {
  id: string;
  label: string;
  valueKind: FilterValueKind;
  negative?: boolean;
}

// ---- query ----------------------------------------------------------------
export interface SortSpec {
  columnId: string;
  dir: "asc" | "desc";
}
export type AggregationId = "count" | "sum" | "avg" | "min" | "max" | "countEmpty" | "countFilled";
export interface GroupSpec {
  columnId: string;
  aggregations?: { columnId: string; agg: AggregationId }[];
}
export type PageRequest =
  | { offset: number; limit: number; cursor?: never }
  | { cursor: string; limit: number; offset?: never };
export interface GridQuery {
  filter: FilterNode | null;
  sort: SortSpec[];
  search?: string;
  groupBy?: GroupSpec[];
  page: PageRequest;
  includeTotal?: boolean;
}
export interface GroupAggregateValue {
  columnId: string;
  agg: AggregationId;
  value: number | string | null;
}
export interface GroupResult {
  columnId: string;
  value: unknown;
  key: string;
  count: number;
  aggregates: GroupAggregateValue[];
  children?: GroupResult[];
}
export interface QueryResult<Row extends GridRow = GridRow> {
  rows: Row[];
  total?: number;
  nextCursor?: string;
  groups?: GroupResult[];
}

// ---- rows -----------------------------------------------------------------
export interface GridRow {
  id: string;
  version: number;
  updatedAt: ISODateTimeString;
  updatedBy?: ActorRef;
  cells: Record<string, unknown>;
}
export interface CellChange {
  rowId: string;
  columnId: string;
  prev: unknown;
  next: unknown;
}
export type ChangeSource = "edit" | "paste" | "fill" | "undo" | "redo" | "import";
export interface ChangeBatch {
  id: string;
  changes: CellChange[];
  baseVersions: Record<string, number>;
  source: ChangeSource;
}
export interface ChangeConflict {
  rowId: string;
  columnId: string;
  serverValue: unknown;
  serverVersion: number;
  updatedBy?: ActorRef;
  updatedAt: ISODateTimeString;
}
export interface ChangeError {
  rowId: string;
  columnId: string;
  message: string;
}
export interface ChangeResult {
  applied: CellChange[];
  conflicts: ChangeConflict[];
  errors: ChangeError[];
}
export interface ChangeFeedEntry<Row extends GridRow = GridRow> {
  cursor: string;
  rows: Row[];
  deletedRowIds: string[];
  schemaVersion: number;
}

// ---- datasource -----------------------------------------------------------
export interface RowPartial<Row extends GridRow = GridRow> {
  id?: string;
  cells?: Partial<Row["cells"]>;
}
export interface DataSource<Row extends GridRow = GridRow> {
  fetch(query: GridQuery): Promise<QueryResult<Row>>;
  applyChanges(batch: ChangeBatch): Promise<ChangeResult>;
  createRows(partials: RowPartial<Row>[]): Promise<Row[]>;
  deleteRows(ids: string[]): Promise<void>;
  getChanges?(since: string): Promise<ChangeFeedEntry<Row>>;
  getOptions?(columnId: string, search?: string): Promise<Option[]>;
  createOption?(columnId: string, label: string): Promise<Option>;
  lookup?(columnId: string, search: string): Promise<LinkRef[]>;
}

// ---- permissions ----------------------------------------------------------
export type Access = "hidden" | "read" | "edit";
export interface PermissionUser {
  id: string;
  roles: string[];
}
export interface PermissionContext {
  user: PermissionUser;
  column: ColumnDef;
  row?: GridRow;
}
export type PermissionResolver = (ctx: PermissionContext) => Access;

// ---- field types ----------------------------------------------------------
export type ParseResult<T> =
  | { ok: true; value: T; pendingOptions?: string[]; warnings?: string[] }
  | { ok: false; error: string };

export interface FieldType<TValue = unknown, TConfig = unknown> {
  id: FieldTypeId;
  label: string;
  configSchema: ZodType<TConfig>;
  defaultConfig: TConfig;
  valueSchema(config: TConfig): ZodType<TValue | null>;
  parse(input: unknown, config: TConfig): ParseResult<TValue | null>;
  format(value: TValue | null, config: TConfig): string;
  serialize(value: TValue | null): TValue | null;
  deserialize(raw: unknown): TValue | null;
  compare(a: TValue | null, b: TValue | null, config: TConfig): number;
  operators: readonly FilterOperatorDef[];
  fillSeries?(values: TValue[], count: number): TValue[];
  aggregations?: readonly AggregationId[];
  defaultValue(config: TConfig): TValue | null;
}
// biome-ignore lint/suspicious/noExplicitAny: erased field type, mirrors core's AnyFieldType
export type AnyFieldType = FieldType<any, any>;

export interface FieldTypeRegistry {
  register(type: AnyFieldType): void;
  get(id: string): AnyFieldType | undefined;
  list(): AnyFieldType[];
  has(id: string): boolean;
}

// ---- formula --------------------------------------------------------------
export type FormulaResultType = "number" | "text" | "boolean" | "date";
export type FormulaErrorCode =
  | "syntax"
  | "unknownFunction"
  | "arity"
  | "type"
  | "unknownColumn"
  | "cycle"
  | "eval";
export interface FormulaError {
  kind: "formulaError";
  code: FormulaErrorCode;
  message: string;
  start?: number;
  end?: number;
  columnKey?: string;
}
interface NodeSpan {
  start: number;
  end: number;
}
export interface NumberLiteral extends NodeSpan {
  type: "NumberLiteral";
  value: number;
}
export interface StringLiteral extends NodeSpan {
  type: "StringLiteral";
  value: string;
}
export interface BooleanLiteral extends NodeSpan {
  type: "BooleanLiteral";
  value: boolean;
}
export interface ColumnRef extends NodeSpan {
  type: "ColumnRef";
  key: string;
}
export interface UnaryExpr extends NodeSpan {
  type: "UnaryExpr";
  op: "-" | "!";
  operand: FormulaNode;
}
export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||";
export interface BinaryExpr extends NodeSpan {
  type: "BinaryExpr";
  op: BinaryOp;
  left: FormulaNode;
  right: FormulaNode;
}
export interface CallExpr extends NodeSpan {
  type: "CallExpr";
  name: string;
  args: FormulaNode[];
}
export type FormulaNode =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | ColumnRef
  | UnaryExpr
  | BinaryExpr
  | CallExpr;
export type FormulaValue = number | string | boolean | null;
export interface FormulaEnv {
  now: Date;
  tz: string;
}
