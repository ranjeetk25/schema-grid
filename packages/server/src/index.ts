/**
 * `@ranjeetk25/schema-grid-server` root entry — Node-only, drizzle-free at runtime.
 * SQL/Drizzle APIs live in `@ranjeetk25/schema-grid-server/drizzle`, DDL helpers in `/ddl`.
 */
// Injected from package.json by tsup (`define`) and by vitest.config.ts; source
// consumers without either (e.g. the Storybook dev build) get the dev fallback.
declare const __SCHEMA_GRID_SERVER_VERSION__: string | undefined;
export const SCHEMA_GRID_SERVER_VERSION: string =
  typeof __SCHEMA_GRID_SERVER_VERSION__ === "string" ? __SCHEMA_GRID_SERVER_VERSION__ : "0.0.0-dev";

export {
  CursorError,
  type ErrorDetails,
  FilterValidationError,
  FormulaQueryLimitError,
  GroupingError,
  guardMissingTable,
  isNoSuchTableError,
  MissingTableError,
  PermissionError,
  type PermissionErrorCode,
  type PermissionUsage,
  RowValidationError,
  SchemaGridServerError,
  type SchemaIssue,
  SchemaValidationError,
  type TableDdlHelper,
  translateMissingTable,
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
