import type { LinkRef, Option } from "../common/types";
import type { DataSourceCapabilities } from "../datasource/capabilities";
import type { DataSource, RowPartial } from "../datasource/types";
import type { GridQuery, QueryResult } from "../query/types";
import type { ChangeBatch, ChangeFeedEntry, ChangeResult, GridRow } from "../rows/types";
import { isWireError, isWireErrorCode, RemoteDataSourceError } from "./errors";
import { toWireIssues } from "./issues";
import type { GridOperation, OptionalGridOperation, WireInput, WireOutput } from "./operations";
import { wireSchemas } from "./schemas";

/**
 * Sends one operation to wherever the grid's data source lives and resolves
 * with its JSON output (or throws). Examples:
 * `(op, input) => trpc.grid[op].mutate(input)` or an HTTP POST per op.
 */
export type GridTransport = <Op extends GridOperation>(op: Op, input: WireInput<Op>) => Promise<unknown>;

export interface RemoteDataSourceOptions {
  /**
   * Which optional operations the server implements. Default: all true.
   * `capabilities: false` for servers older than v0.2 (the grid then infers them).
   */
  supports?: Partial<Record<OptionalGridOperation | "capabilities", boolean>>;
  /** Validate responses against the wire schemas. Default true. */
  validateOutput?: boolean;
}

function asRemoteError(err: unknown): unknown {
  if (err instanceof RemoteDataSourceError) return err;
  if (!isWireError(err)) return err;
  // Plain `{ code, message }` bodies always; Error instances only with a wire code
  // (so `ECONNREFUSED`-style network errors pass through untouched).
  if (err instanceof Error && !isWireErrorCode(err.code)) return err;
  const status = (err as { status?: unknown }).status;
  const wire =
    err.details === undefined
      ? { code: err.code, message: err.message }
      : { code: err.code, message: err.message, details: err.details };
  return new RemoteDataSourceError(wire, typeof status === "number" ? status : undefined);
}

/**
 * A `DataSource<GridRow>` whose operations run through `transport`. Pair it
 * with `createDataSourceHandler` on the server side.
 */
export function createRemoteDataSource(
  transport: GridTransport,
  options: RemoteDataSourceOptions = {},
): DataSource<GridRow> {
  const validate = options.validateOutput !== false;

  async function call<Op extends GridOperation>(op: Op, input: WireInput<Op>): Promise<WireOutput<Op>> {
    let raw: unknown;
    try {
      raw = await transport(op, input);
    } catch (err) {
      throw asRemoteError(err);
    }
    if (op === "deleteRows") return null as WireOutput<Op>;
    if (validate) {
      const checked = wireSchemas[op].output.safeParse(raw);
      if (!checked.success) {
        throw new RemoteDataSourceError({
          code: "OUTPUT_INVALID",
          message: `Invalid "${op}" response`,
          details: { issues: toWireIssues(checked.error) },
        });
      }
    }
    return raw as WireOutput<Op>;
  }

  const supports = (op: OptionalGridOperation | "capabilities") => options.supports?.[op] !== false;

  const ds: DataSource<GridRow> = {
    fetch: (query: GridQuery): Promise<QueryResult<GridRow>> => call("fetch", query),
    applyChanges: (batch: ChangeBatch): Promise<ChangeResult> => call("applyChanges", batch),
    createRows: (partials: RowPartial<GridRow>[]): Promise<GridRow[]> => call("createRows", { partials }),
    deleteRows: async (ids: string[]): Promise<void> => {
      await call("deleteRows", { ids });
    },
  };
  if (supports("getChanges")) {
    ds.getChanges = (since: string): Promise<ChangeFeedEntry<GridRow>> => call("getChanges", { since });
  }
  if (supports("getOptions")) {
    ds.getOptions = (columnId: string, search?: string): Promise<Option[]> =>
      call("getOptions", search === undefined ? { columnId } : { columnId, search });
  }
  if (supports("createOption")) {
    ds.createOption = (columnId: string, label: string): Promise<Option> => call("createOption", { columnId, label });
  }
  if (supports("lookup")) {
    ds.lookup = (columnId: string, search: string): Promise<LinkRef[]> => call("lookup", { columnId, search });
  }
  if (supports("capabilities")) {
    ds.capabilities = (): Promise<DataSourceCapabilities> => call("capabilities", null);
  }
  return ds;
}
