import type { DataSource } from "../datasource/types";
import type { GridRow } from "../rows/types";
import { httpStatusFor, RemoteDataSourceError, toWireError, type WireError } from "./errors";
import { toWireIssues } from "./issues";
import {
  type GridOperation,
  isGridOperation,
  isGridSchemaOperation,
  OPTIONAL_GRID_OPERATIONS,
  type OptionalGridOperation,
  type WireInput,
  type WireOutput,
} from "./operations";
import { wireSchemas } from "./schemas";

/** Transport-neutral outcome of one grid operation. */
export type WireResult<T = unknown> = { ok: true; data: T } | { ok: false; error: WireError; status: number };

/** Output type of `op` when it names a grid operation. */
export type WireOutputOf<Op extends string> = Op extends GridOperation ? WireOutput<Op> : never;

/** Runs one grid operation from untrusted input. Never throws. */
export type DataSourceHandler = <Op extends string>(op: Op, input: unknown) => Promise<WireResult<WireOutputOf<Op>>>;

export interface DataSourceHandlerOptions {
  /** Validate data source results against the wire schemas (OUTPUT_INVALID on mismatch). Default false; enable in dev/tests. */
  validateOutput?: boolean;
  /** Return the message of unrecognised errors instead of "Internal error". Default false. */
  exposeInternalErrors?: boolean;
  /** Custom error mapping, tried before the built-in one; return undefined to fall through. */
  mapError?: (err: unknown, op: GridOperation) => WireError | undefined;
  /** Called for every failure (logging/metrics). Exceptions thrown here are ignored. */
  onError?: (err: unknown, info: { op: string; error: WireError; status: number }) => void;
}

const OPTIONAL: ReadonlySet<string> = new Set(OPTIONAL_GRID_OPERATIONS);

function isOptional(op: GridOperation): op is OptionalGridOperation {
  return OPTIONAL.has(op);
}

async function invoke(ds: DataSource<GridRow>, op: GridOperation, input: unknown): Promise<unknown> {
  switch (op) {
    case "fetch":
      return ds.fetch(input as WireInput<"fetch">);
    case "applyChanges":
      return ds.applyChanges(input as WireInput<"applyChanges">);
    case "createRows":
      return ds.createRows((input as WireInput<"createRows">).partials);
    case "deleteRows":
      await ds.deleteRows((input as WireInput<"deleteRows">).ids);
      return null;
    case "getChanges":
      return ds.getChanges?.((input as WireInput<"getChanges">).since);
    case "getOptions": {
      const i = input as WireInput<"getOptions">;
      return i.search === undefined ? ds.getOptions?.(i.columnId) : ds.getOptions?.(i.columnId, i.search);
    }
    case "createOption": {
      const i = input as WireInput<"createOption">;
      return ds.createOption?.(i.columnId, i.label);
    }
    case "lookup": {
      const i = input as WireInput<"lookup">;
      return ds.lookup?.(i.columnId, i.search);
    }
    default:
      // Grid-level operations are rejected before `invoke` (see `handle`).
      return undefined;
  }
}

function fail(code: string, message: string, details?: unknown): { ok: false; error: WireError; status: number } {
  const error: WireError = details === undefined ? { code, message } : { code, message, details };
  return { ok: false, error, status: httpStatusFor(code) };
}

/**
 * Wraps a `DataSource` as `(op, input) => WireResult`: validates the input
 * with the op's zod schema, calls the data source, optionally validates the
 * output, and maps thrown errors to `WireError` + HTTP status. Mount it
 * behind any transport (tRPC, Express, Hono, Lambda, ...).
 */
export function createDataSourceHandler(
  dataSource: DataSource<GridRow>,
  options: DataSourceHandlerOptions = {},
): DataSourceHandler {
  const report = (err: unknown, op: string, result: { error: WireError; status: number }) => {
    try {
      options.onError?.(err, { op, error: result.error, status: result.status });
    } catch {
      // a failing logger must not turn into a failed response
    }
  };

  async function handle(op: string, rawInput: unknown): Promise<WireResult> {
    if (!isGridOperation(op)) {
      const result = fail("UNKNOWN_OPERATION", `Unknown grid operation "${op}"`);
      report(undefined, op, result);
      return result;
    }
    if (isGridSchemaOperation(op)) {
      const result = fail(
        "UNSUPPORTED_OPERATION",
        `"${op}" is served by a grid registry (defineGrid), not by a data source`,
      );
      report(undefined, op, result);
      return result;
    }
    if (isOptional(op) && typeof dataSource[op] !== "function") {
      const result = fail("UNSUPPORTED_OPERATION", `This data source does not support "${op}"`);
      report(undefined, op, result);
      return result;
    }
    const parsed = wireSchemas[op].input.safeParse(rawInput);
    if (!parsed.success) {
      const issues = toWireIssues(parsed.error);
      const filterOnly = op === "fetch" && issues.length > 0 && issues.every((i) => i.path[0] === "filter");
      const result = filterOnly
        ? fail("FILTER_INVALID", "Malformed filter", { issues })
        : fail("INPUT_INVALID", `Invalid input for "${op}"`, { issues });
      report(parsed.error, op, result);
      return result;
    }
    try {
      const data = await invoke(dataSource, op, parsed.data);
      if (options.validateOutput) {
        const checked = wireSchemas[op].output.safeParse(data);
        if (!checked.success) {
          const result = fail("OUTPUT_INVALID", `Data source returned an invalid "${op}" result`, {
            issues: toWireIssues(checked.error),
          });
          report(checked.error, op, result);
          return result;
        }
      }
      return { ok: true, data };
    } catch (err) {
      let error: WireError | undefined;
      try {
        error = options.mapError?.(err, op);
      } catch {
        error = undefined;
      }
      error ??= toWireError(err, { exposeInternal: options.exposeInternalErrors === true });
      const result = { ok: false as const, error, status: httpStatusFor(error.code) };
      report(err, op, result);
      return result;
    }
  }

  return handle as DataSourceHandler;
}

/** Returns `data` of an ok result, or throws the failure as a `RemoteDataSourceError`. */
export function unwrapWireResult<T>(result: WireResult<T>): T {
  if (result.ok) return result.data;
  throw new RemoteDataSourceError(result.error, result.status);
}
