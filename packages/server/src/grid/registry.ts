import { type ContextArgs, toWireFailure, reportFailure, type WireFailure } from "../http/adapter";
import {
  createDataSourceHandler,
  createDefaultRegistry,
  type DataSourceHandlerOptions,
  type GridOperation,
  type GridSchema,
  httpStatusFor,
  isGridOperation,
  type WireError,
  type WireOutputOf,
  type WireResult,
  wireSchemas,
} from "../internal/core";
import { assertValidSchema } from "../schema/validate-schema";
import type { GridDefinition } from "./define-grid";

/** One entry of `registry.list(ctx)`. */
export interface GridListing {
  id: string;
}

export type GridRegistryOptions = DataSourceHandlerOptions;

/** Every grid behind one endpoint: `handle(gridId, op, input, ctx)`. */
export interface GridRegistry<Ctx = undefined> {
  readonly kind: "schema-grid/registry";
  /** Runs one operation on one grid from untrusted input. Never throws. */
  handle<Op extends string>(
    gridId: string,
    op: Op,
    input: unknown,
    ...ctx: ContextArgs<Ctx>
  ): Promise<WireResult<WireOutputOf<Op>>>;
  /** The grids this context may open (`permission(ctx, "getSchema")`), in registration order. */
  list(...ctx: ContextArgs<Ctx>): Promise<GridListing[]>;
  /** Maps an error raised outside `handle` (context resolution, body parsing) the same way `handle` would. */
  failure(err: unknown, op: string): WireFailure;
  /** The definition registered under `gridId`. */
  get(gridId: string): GridDefinition<Ctx> | undefined;
}

export function isGridRegistry(value: unknown): value is GridRegistry<unknown> {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "schema-grid/registry";
}

class WireFault extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WireFault";
  }
}

/** Serialises async work per key (read-modify-write of one grid's schema). */
function keyedMutex() {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}

/**
 * Serves many `defineGrid` grids behind one endpoint. Unknown grid →
 * `UNKNOWN_GRID` 404; `permission(ctx, op)` false → `PERMISSION_DENIED` 403;
 * data operations run through `createDataSourceHandler` on `source(ctx, …)`;
 * `getSchema` / `updateSchema` are served here (schema store + validation).
 */
export function createGridRegistry<Ctx = undefined>(
  definitions: ReadonlyArray<GridDefinition<Ctx>>,
  options: GridRegistryOptions = {},
): GridRegistry<Ctx> {
  const grids = new Map<string, GridDefinition<Ctx>>();
  for (const def of definitions) {
    if (grids.has(def.id)) throw new Error(`Duplicate grid id "${def.id}"`);
    grids.set(def.id, def);
  }
  const exclusive = keyedMutex();
  const defaultRegistry = createDefaultRegistry();

  const failure = (err: unknown, op: string): WireFailure => toWireFailure(err, op, options);

  const fail = (code: string, message: string, op: string, details?: unknown): WireFailure => {
    const error: WireError = details === undefined ? { code, message } : { code, message, details };
    const result: WireFailure = { ok: false, error, status: httpStatusFor(code) };
    reportFailure(undefined, result, op, options);
    return result;
  };

  async function currentSchema(def: GridDefinition<Ctx>, ctx: Ctx): Promise<GridSchema> {
    const stored = def.schemaStore ? await def.schemaStore.get(def.id) : null;
    if (stored) return stored;
    return typeof def.schema === "function" ? await def.schema(ctx) : def.schema;
  }

  function parse<Op extends "getSchema" | "updateSchema">(op: Op, input: unknown) {
    const parsed = wireSchemas[op].input.safeParse(input);
    if (!parsed.success) {
      throw new WireFault("INPUT_INVALID", `Invalid input for "${op}"`, {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.map((p) => (typeof p === "number" ? p : String(p))),
          message: i.message,
        })),
      });
    }
    return parsed.data;
  }

  async function updateSchema(def: GridDefinition<Ctx>, input: unknown, ctx: Ctx): Promise<GridSchema> {
    const store = def.schemaStore;
    if (!store) {
      throw new WireFault("UNSUPPORTED_OPERATION", `Grid "${def.id}" has no schema store; its schema is read-only`);
    }
    const candidate = parse("updateSchema", input);
    return exclusive(def.id, async () => {
      const prev = await currentSchema(def, ctx);
      if (candidate.id !== prev.id) {
        throw new WireFault("INPUT_INVALID", `Schema id "${candidate.id}" does not match "${prev.id}"`);
      }
      if (candidate.schemaVersion !== prev.schemaVersion) {
        throw new WireFault(
          "SCHEMA_CONFLICT",
          `Schema is at version ${prev.schemaVersion}, got ${candidate.schemaVersion}`,
          { currentVersion: prev.schemaVersion },
        );
      }
      const next: GridSchema = { ...candidate, schemaVersion: prev.schemaVersion + 1 };
      assertValidSchema(next, def.registry ?? defaultRegistry, def.validation);
      await def.onSchemaChange?.(ctx, prev, next);
      await store.put(def.id, next);
      return next;
    });
  }

  async function run(def: GridDefinition<Ctx>, op: GridOperation, input: unknown, ctx: Ctx): Promise<WireResult> {
    if (op === "getSchema") {
      parse("getSchema", input);
      return { ok: true, data: await currentSchema(def, ctx) };
    }
    if (op === "updateSchema") return { ok: true, data: await updateSchema(def, input, ctx) };
    const schema = await currentSchema(def, ctx);
    const ds = await def.source(ctx, { gridId: def.id, schema });
    return createDataSourceHandler(ds, options)(op, input);
  }

  async function handle(gridId: string, op: string, input: unknown, ctx?: Ctx): Promise<WireResult> {
    const def = typeof gridId === "string" ? grids.get(gridId) : undefined;
    if (!def) return fail("UNKNOWN_GRID", `Unknown grid "${String(gridId)}"`, op);
    if (!isGridOperation(op)) return fail("UNKNOWN_OPERATION", `Unknown grid operation "${op}"`, op);
    try {
      if (def.permission && !(await def.permission(ctx as Ctx, op))) {
        return fail("PERMISSION_DENIED", `Not allowed to run "${op}" on grid "${def.id}"`, op);
      }
      return await run(def, op, input, ctx as Ctx);
    } catch (err) {
      if (err instanceof WireFault) return fail(err.code, err.message, op, err.details);
      return failure(err, op);
    }
  }

  async function list(ctx?: Ctx): Promise<GridListing[]> {
    const out: GridListing[] = [];
    for (const def of grids.values()) {
      let allowed = true;
      try {
        allowed = def.permission ? await def.permission(ctx as Ctx, "getSchema") : true;
      } catch {
        allowed = false;
      }
      if (allowed) out.push({ id: def.id });
    }
    return out;
  }

  return {
    kind: "schema-grid/registry",
    handle: handle as GridRegistry<Ctx>["handle"],
    list: list as GridRegistry<Ctx>["list"],
    failure,
    get: (gridId) => grids.get(gridId),
  };
}
