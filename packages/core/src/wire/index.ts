// `@ranjeetk25/schema-grid-core/wire` — transport-neutral contract for running a
// DataSource across a network boundary (tRPC, REST, Hono, Lambda, ...).
export {
  GRID_OPERATIONS,
  isGridOperation,
  OPTIONAL_GRID_OPERATIONS,
  type GridOperation,
  type GridWireContract,
  type OptionalGridOperation,
  type WireInput,
  type WireOutput,
} from "./operations";
export { filterNodeSchema, gridQuerySchema, gridRowSchema, wireSchemas, type WireSchema, type WireSchemas } from "./schemas";
export {
  httpStatusFor,
  isWireError,
  isWireErrorCode,
  RemoteDataSourceError,
  toWireError,
  WIRE_ERROR_STATUS,
  type ToWireErrorOptions,
  type WireError,
  type WireErrorCode,
} from "./errors";
export type { WireIssue } from "./issues";
export {
  createDataSourceHandler,
  unwrapWireResult,
  type DataSourceHandler,
  type DataSourceHandlerOptions,
  type WireOutputOf,
  type WireResult,
} from "./handler";
export { createRemoteDataSource, type GridTransport, type RemoteDataSourceOptions } from "./remote";
