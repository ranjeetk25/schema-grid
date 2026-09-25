/**
 * `@ranjeetk25/schema-grid-server/http` — mount grids behind any transport:
 * `defineGrid` + `createGridRegistry` + `toFetchHandler` / `toExpressRouter` /
 * `toLambdaHandler` for many grids on one endpoint, or `createGridRouterAdapter`
 * for a single `DataSource`. Framework-free: the Express and Lambda adapters are typed
 * structurally and import nothing.
 */
export {
  type ContextArgs,
  createGridRouterAdapter,
  type GridDataSourceFactory,
  type GridRouterAdapter,
  parseJsonBody,
  toHttpResponse,
  toWireFailure,
  type WireFailure,
} from "./adapter";
export {
  createGridRegistry,
  createMemorySchemaStore,
  defineGrid,
  type GridDefinition,
  type GridDefinitionInput,
  type GridListing,
  type GridRegistry,
  type GridRegistryOptions,
  type GridSourceInfo,
  isGridRegistry,
  type MemorySchemaStore,
  type SchemaStore,
} from "../grid/index";
export { type FetchHandlerOptions, toFetchHandler } from "./fetch";
export {
  type ExpressLikeNext,
  type ExpressLikeRouterRequest,
  type ExpressRouterOptions,
  toExpressRouter,
} from "./router";
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
  GridSchemaOperation,
  WireError,
  WireResult,
} from "../internal/core";
