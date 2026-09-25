/**
 * `@masai/schema-grid-server` root entry — Node-only, drizzle-free at runtime.
 * SQL/Drizzle APIs live in `@masai/schema-grid-server/drizzle`, DDL helpers in `/ddl`.
 */
export const SCHEMA_GRID_SERVER_VERSION = "0.0.1";

export {
  CursorError,
  type ErrorDetails,
  FilterValidationError,
  FormulaQueryLimitError,
  GroupingError,
  PermissionError,
  type PermissionUsage,
  RowValidationError,
  SchemaGridServerError,
  type SchemaIssue,
  SchemaValidationError,
  UnsupportedOperatorError,
} from "./errors";
export {
  DEFAULT_FORMULA_FALLBACK_ROW_CAP,
  type ServerContext,
  type ServerContextInput,
  type ServerWarning,
  createServerContext,
} from "./context";
export {
  type SchemaValidationResult,
  type ValidateSchemaOptions,
  assertValidSchema,
  validateSchema,
} from "./schema/validate-schema";
export { type AccessMap, assertQueryAccess, isReadable, resolveAccess } from "./access/query-access";
export { projectRow } from "./access/project-row";
export { type GroupPin, pinGroupFilter } from "./grouping/pin-group-filter";
export { type CursorPayload, decodeCursor, encodeCursor, queryFingerprint } from "./pagination/cursor";
export { type IterateQueryOptions, iterateQuery } from "./jobs/query-iterator";
export {
  type ExportWriter,
  type ExportWriterInput,
  type StreamExportOptions,
  streamExport,
} from "./jobs/stream-export";
export {
  type ImportFailure,
  type ImportJobReport,
  type ImportJobStore,
  type ImportProgress,
  type RunImportJobOptions,
  runImportJob,
} from "./jobs/run-import-job";
