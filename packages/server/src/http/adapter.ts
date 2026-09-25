import {
  createDataSourceHandler,
  type DataSource,
  type DataSourceHandler,
  type DataSourceHandlerOptions,
  type GridRow,
  httpStatusFor,
  toWireError,
  type WireError,
  type WireOutputOf,
  type WireResult,
} from "../internal/core";

/** Builds the data source for one request (bind the user, tenant, db handle, ...). */
export type GridDataSourceFactory<Ctx> = (ctx: Ctx) => DataSource<GridRow> | Promise<DataSource<GridRow>>;

/** `[ctx?]` when the context may be undefined, `[ctx]` otherwise. */
export type ContextArgs<Ctx> = undefined extends Ctx ? [ctx?: Ctx] : [ctx: Ctx];

export type WireFailure = { ok: false; error: WireError; status: number };

export interface GridRouterAdapter<Ctx = undefined> {
  /** Runs one operation from untrusted input. Never throws. */
  handle<Op extends string>(op: Op, input: unknown, ...ctx: ContextArgs<Ctx>): Promise<WireResult<WireOutputOf<Op>>>;
  /** Maps an error raised outside `handle` (context resolution, body parsing) the same way `handle` would. */
  failure(err: unknown, op: string): WireFailure;
}

/**
 * Transport-neutral grid endpoint: one `handle(op, input, ctx)` that every
 * framework adapter (Express, Lambda, Hono, tRPC, ...) calls. Pass a fixed
 * `DataSource` or a per-request factory; errors thrown by the factory are
 * mapped like data source errors (e.g. throw `{ code: "UNAUTHENTICATED" }`).
 */
export function createGridRouterAdapter<Ctx = undefined>(
  source: DataSource<GridRow> | GridDataSourceFactory<Ctx>,
  options: DataSourceHandlerOptions = {},
): GridRouterAdapter<Ctx> {
  const fixed: DataSourceHandler | undefined =
    typeof source === "function" ? undefined : createDataSourceHandler(source, options);

  function failure(err: unknown, op: string): WireFailure {
    let error: WireError | undefined;
    try {
      error = options.mapError?.(err, op as never);
    } catch {
      error = undefined;
    }
    error ??= toWireError(err, { exposeInternal: options.exposeInternalErrors === true });
    const result: WireFailure = { ok: false, error, status: httpStatusFor(error.code) };
    try {
      options.onError?.(err, { op, error: result.error, status: result.status });
    } catch {
      // ignore logger failures
    }
    return result;
  }

  async function handle(op: string, input: unknown, ctx?: Ctx): Promise<WireResult> {
    if (fixed) return fixed(op, input);
    try {
      const ds = await (source as GridDataSourceFactory<Ctx>)(ctx as Ctx);
      return await createDataSourceHandler(ds, options)(op, input);
    } catch (err) {
      return failure(err, op);
    }
  }

  return { handle: handle as GridRouterAdapter<Ctx>["handle"], failure };
}

/** Status + JSON body for any HTTP framework: `{ data }` on success, `{ error }` otherwise. */
export function toHttpResponse(result: WireResult): { status: number; body: { data: unknown } | { error: WireError } } {
  return result.ok ? { status: 200, body: { data: result.data } } : { status: result.status, body: { error: result.error } };
}

/** Parses a raw request body (JSON text or an already-parsed value). */
export function parseJsonBody(body: unknown): { ok: true; value: unknown } | { ok: false; error: WireError } {
  if (typeof body !== "string") return { ok: true, value: body };
  if (body.trim() === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, error: { code: "INPUT_INVALID", message: "Request body is not valid JSON" } };
  }
}

/** Shared request pipeline for the reference adapters. Never throws. */
export async function runRequest<Ctx>(
  adapter: GridRouterAdapter<Ctx>,
  op: string,
  rawBody: unknown,
  resolveContext: (() => Ctx | Promise<Ctx>) | undefined,
): Promise<WireResult> {
  try {
    const parsed = parseJsonBody(rawBody);
    if (!parsed.ok) return { ok: false, error: parsed.error, status: httpStatusFor(parsed.error.code) };
    const ctx = resolveContext ? await resolveContext() : undefined;
    const handle = adapter.handle as (op: string, input: unknown, ctx?: Ctx) => Promise<WireResult>;
    return await handle(op, parsed.value, ctx);
  } catch (err) {
    return adapter.failure(err, op);
  }
}
