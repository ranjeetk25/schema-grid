import type { ActorRef, LinkRef } from "../common/types";
import type { DataSource } from "../datasource/types";
import type { FieldTypeRegistry } from "../field-types/registry";
import type { FilterValidationError, FilterValidationErrorCode } from "../filter/validate";
import type { PermissionResolver, PermissionUser } from "../permissions/types";
import type { GridRow } from "../rows/types";
import type { GridSchema } from "../schema/types";

export interface InMemoryDataSourceOptions<Row extends GridRow = GridRow> {
  schema: GridSchema;
  /** Default: createDefaultRegistry(). */
  registry?: FieldTypeRegistry;
  /** Initial rows (deep-copied). */
  rows?: Row[];
  /** The acting user. When omitted, every column is fully accessible. */
  user?: PermissionUser;
  /** Default: createRolePermissionResolver(). */
  resolver?: PermissionResolver;
  /** Clock used for relative dates, formulas and updatedAt. Default: () => new Date(). */
  now?: () => Date;
  /** Default: "Asia/Kolkata". */
  timeZone?: string;
  /** Row id generator. Default: sequential ids. */
  generateId?: () => string;
  /** Recorded as `updatedBy` on writes. */
  actor?: ActorRef;
  /** Link targets for `lookup`, keyed by column id. */
  linkTargets?: Record<string, LinkRef[]>;
}

export interface InMemoryDataSource<Row extends GridRow = GridRow> extends DataSource<Row> {
  getSchema(): GridSchema;
  setSchema(schema: GridSchema): void;
  /** Deep copies of all stored rows (unprojected, formulas computed now). */
  snapshot(): Row[];
}

export type InMemoryQueryErrorCode =
  | FilterValidationErrorCode
  | "invalidAggregation"
  | "invalidPage"
  | "invalidCursor"
  | "notEditable"
  | "unsupportedColumnType"
  | "invalidValue";

/** Rejection reason for invalid queries against the in-memory DataSource. */
export class InMemoryQueryError extends Error {
  readonly code: InMemoryQueryErrorCode;
  readonly errors: FilterValidationError[];

  constructor(code: InMemoryQueryErrorCode, message: string, errors: FilterValidationError[] = []) {
    super(message);
    this.name = "InMemoryQueryError";
    this.code = code;
    this.errors = errors;
  }
}
