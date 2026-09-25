/**
 * `@masai/schema-grid-server/http` — mount a grid `DataSource` behind any
 * transport. Framework-free: the Express and Lambda adapters are typed
 * structurally and import nothing.
 */
export {
  type ContextArgs,
  createGridRouterAdapter,
  type GridDataSourceFactory,
  type GridRouterAdapter,
  parseJsonBody,
  toHttpResponse,
  type WireFailure,
} from "./adapter";
export {
  type ExpressHandlerOptions,
  type ExpressLikeRequest,
  type ExpressLikeResponse,
  toExpressHandler,
} from "./express";
export { type LambdaHandlerOptions, type LambdaLikeEvent, type LambdaLikeResult, toLambdaHandler } from "./lambda";
export type {
  DataSourceHandlerOptions,
  GridOperation,
  WireError,
  WireResult,
} from "../internal/core";
