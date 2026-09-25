// Public barrel for `@masai/schema-grid-ag-grid/sync`.
export {
  usePollingSync,
  type UsePollingSyncOptions,
  type UsePollingSyncResult,
} from "./usePollingSync";
export {
  mergeDeferred,
  planRemotePatch,
  type PlanRemotePatchOptions,
  type RemotePatchPlan,
} from "./planRemotePatch";
export { useDocumentVisible } from "./useDocumentVisible";
export {
  applyDeferredRows,
  applyRemotePatch,
  type ApplyDeferredRowsOptions,
  type ApplyRemotePatchOptions,
  type RemotePatchMode,
} from "./applyRemotePatch";
