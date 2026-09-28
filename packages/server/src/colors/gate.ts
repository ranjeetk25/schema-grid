import { SchemaGridServerError } from "../errors";
import type { DataSource, DataSourceCapabilities, GridRow } from "../internal/core";
import type { CellColorStore } from "./color-store";

/** `ds` with `capabilities()` answering asynchronously (it waits for the color store probe). */
export type ColorGatedDataSource<T extends DataSource<GridRow>> = Omit<T, "capabilities"> & {
  capabilities(): Promise<DataSourceCapabilities>;
};

/**
 * v0.4.1: a data source built with a color store that behaves exactly like the
 * one built without it while `store.available()` is false (the colors table
 * does not exist yet): no colors join / lookup, no `colors` on rows,
 * `capabilities.cellColors` read / write false, and `setCellColors` answering
 * `UNSUPPORTED_OPERATION` like a source without it. The probe runs lazily on
 * the first call and is cached for this instance (one data source per request,
 * so the next request probes again; the store itself caches `true`). A probe
 * that rejects (connection error) is not cached and fails the call.
 *
 * `withStore` is built eagerly (construction errors stay synchronous);
 * `withoutStore` only once the probe says the table is missing.
 */
export function gateColorStore<T extends DataSource<GridRow>>(
  store: CellColorStore,
  withStore: T,
  withoutStore: () => T,
): ColorGatedDataSource<T> {
  let chosen: Promise<T> | undefined;
  const resolve = (): Promise<T> => {
    if (!chosen) {
      chosen = store.available().then(
        (ok) => (ok ? withStore : withoutStore()),
        (err: unknown) => {
          chosen = undefined;
          throw err;
        },
      );
    }
    return chosen;
  };
  const gated: Record<string, unknown> = {};
  for (const key of Object.keys(withStore) as (keyof T & string)[]) {
    if (typeof withStore[key] !== "function") continue;
    gated[key] = async (...args: unknown[]) => {
      const ds = await resolve();
      const fn = ds[key] as unknown;
      if (typeof fn !== "function") {
        throw new SchemaGridServerError("UNSUPPORTED_OPERATION", `This data source does not support "${key}"`);
      }
      return (fn as (...a: unknown[]) => unknown).apply(ds, args);
    };
  }
  return gated as ColorGatedDataSource<T>;
}
