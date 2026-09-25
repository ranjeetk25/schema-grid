import type {
  Access,
  ColumnState,
  DataSource,
  FieldTypeRegistry,
  FilterNode,
  GridRow,
  GridSchema,
  PermissionResolver,
  SortSpec,
} from "@ranjeetk25/schema-grid-core";
import { createRolePermissionResolver } from "@ranjeetk25/schema-grid-core";
import { createDefaultRegistry } from "@ranjeetk25/schema-grid-core/field-types";
import { createServerContext, resolveAccess } from "@ranjeetk25/schema-grid-server";
import type { GridDb, GridTables } from "@ranjeetk25/schema-grid-server/drizzle";
import {
  type GridRegistry,
  type SchemaStore as GridSchemaStore,
  createGridRegistry,
  createMemorySchemaStore,
  parseJsonBody,
  toFetchHandler,
  toHttpResponse,
} from "@ranjeetk25/schema-grid-server/http";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { admissionsGrid } from "./admissions-grid";
import { type GridEnv, resetGrid } from "./bootstrap";
import { type GridRequestContext, requestContext } from "./context";
import { buildExportResponse } from "./export";
import { HttpError, toErrorResponse } from "./http-error";
import { ImportJobs, startImport } from "./import-jobs";
import { leadsGrid } from "./leads/grid";
import { leadsTable, resetLeads } from "./leads/table";
import type { SchemaStore } from "./schema-store";

export type { GridRequestContext } from "./context";

export interface AppDeps {
  db: GridDb;
  tables: GridTables;
  /** Id of the JSON-cells fixture grid (also served by the legacy `/grid/:op` and `/schema` routes). */
  gridId: string;
  store: SchemaStore;
  /** IANA zone for relative dates. */
  tz: string;
  /** Default clock: an ISO instant, or "wall" for the real clock. Overridable per request with `x-now`. */
  clock: string;
  jobs?: ImportJobs;
  registry?: FieldTypeRegistry;
  resolver?: PermissionResolver;
  /** Override the fixture grid's per-request data source (tests). Default: Drizzle over MySQL. */
  dataSource?: (ctx: GridRequestContext) => DataSource<GridRow>;
  /** The SQL-view grid over a plain table. Default: table `leads`, in-memory schema store. */
  leads?: { tableName?: string; schemaStore?: GridSchemaStore };
}

export interface CreatedApp {
  app: Hono;
  jobs: ImportJobs;
  /** Every grid behind `/grid/:gridId/:op`. */
  grids: GridRegistry<GridRequestContext>;
}

/** Error `name`s the REST routes used before the grid registry (clients match on them). */
const REST_ERROR_NAMES: Record<string, string> = {
  SCHEMA_INVALID: "SchemaValidationError",
  SCHEMA_CONFLICT: "SchemaVersionConflict",
  PERMISSION_DENIED: "PermissionError",
  INPUT_INVALID: "InputValidationError",
};

function parseJsonParam<T>(value: string | undefined, name: string): T | undefined {
  if (value === undefined || value === "") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new HttpError(400, "InputValidationError", `${name} must be URL-encoded JSON`);
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, "InputValidationError", "Request body must be JSON");
  }
}

export function createApp(deps: AppDeps): CreatedApp {
  const registry = deps.registry ?? createDefaultRegistry();
  const resolver = deps.resolver ?? createRolePermissionResolver();
  const jobs = deps.jobs ?? new ImportJobs();
  const env: GridEnv = { db: deps.db, tables: deps.tables, gridId: deps.gridId, tz: deps.tz };
  const leadsTableName = deps.leads?.tableName ?? "leads";
  const leads = leadsTable(leadsTableName);
  // TODO(lane-b): createDrizzleSchemaStore so added leads columns survive a restart.
  const leadsSchemaStore = deps.leads?.schemaStore ?? createMemorySchemaStore();

  /** Both grids behind one endpoint: `POST /grid/:gridId/:op`, `GET /grid/:gridId/schema`, `GET /grid`. */
  const grids = createGridRegistry<GridRequestContext>(
    [
      admissionsGrid({ ...deps, registry, resolver }),
      leadsGrid({ db: deps.db, table: leads, tz: deps.tz, schemaStore: leadsSchemaStore }),
    ],
    {
      onError: (err, info) => {
        if (info.status === 500) console.error(err);
      },
    },
  );
  const gridEndpoint = toFetchHandler(grids, {
    basePath: "/grid",
    context: (request) => requestContext(request.headers, deps.clock),
  });

  /** The adapter's `context(req)`: fake auth + clock from the request headers. */
  const context = (c: Context): GridRequestContext =>
    requestContext({ get: (name) => c.req.header(name) }, deps.clock);

  /** Runs one registry op for a REST route; wire failures become `HttpError`s named like the pre-registry routes. */
  const gridOp = async <T>(gridId: string, op: string, input: unknown, ctx: GridRequestContext): Promise<T> => {
    const result = await grids.handle(gridId, op, input, ctx);
    if (!result.ok) {
      const { code, message, details } = result.error;
      throw new HttpError(result.status, REST_ERROR_NAMES[code] ?? code, message, details);
    }
    return result.data as T;
  };

  /** Per-request data source + the matching column access map for `?grid=` (default: the fixture grid). */
  const requestScope = async (
    c: Context,
    gridId: string,
  ): Promise<{ ds: DataSource<GridRow>; access: Map<string, Access>; schema: GridSchema; now: () => Date }> => {
    const ctx = context(c);
    const def = grids.get(gridId);
    if (!def) throw new HttpError(404, "UNKNOWN_GRID", `Unknown grid "${gridId}"`);
    const schema = await gridOp<GridSchema>(gridId, "getSchema", null, ctx);
    if (def.permission && !(await def.permission(ctx, "fetch"))) {
      throw new HttpError(403, "PERMISSION_DENIED", `Not allowed to read grid "${gridId}"`);
    }
    const ds = await def.source(ctx, { gridId, schema });
    const access = resolveAccess(
      createServerContext({ schema, registry, resolver, user: ctx.user, tz: deps.tz, now: ctx.now }),
    );
    return { ds, access, schema, now: ctx.now };
  };

  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
      allowHeaders: ["content-type", "x-user", "x-roles", "x-now"],
      exposeHeaders: ["content-disposition"],
    }),
  );

  app.onError((err, c) => {
    const { status, body } = toErrorResponse(err);
    if (status >= 500) console.error(err);
    return c.json(body, status as ContentfulStatusCode);
  });

  app.notFound((c) =>
    c.json(
      {
        error: {
          name: "NotFound",
          message: `No route for ${c.req.method} ${c.req.path}`,
        },
      },
      404,
    ),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  /** Legacy single-grid wire route: `POST /grid/:op` on the fixture grid (kept for existing clients). */
  app.post("/grid/:op", async (c) => {
    const op = c.req.param("op");
    let result: Awaited<ReturnType<typeof grids.handle>>;
    try {
      const body = parseJsonBody(await c.req.text());
      result = body.ok
        ? await grids.handle(deps.gridId, op, body.value, context(c))
        : { ok: false, error: body.error, status: 400 };
    } catch (err) {
      // Context resolution (e.g. a malformed x-now) fails the same way `handle` would.
      result = grids.failure(err, op);
    }
    const { status, body } = toHttpResponse(result);
    return c.json(body, status as ContentfulStatusCode);
  });

  /** Multi-grid wire endpoint (docs/wire-contract.md "Multi-grid endpoint"). */
  app.all("/grid", (c) => gridEndpoint(c.req.raw));
  app.all("/grid/*", (c) => gridEndpoint(c.req.raw));

  /** Legacy REST schema routes for the fixture grid (the registry's getSchema / updateSchema). */
  app.get("/schema", async (c) => c.json(await gridOp<GridSchema>(deps.gridId, "getSchema", null, context(c))));

  app.put("/schema", async (c) => {
    const body = await readJson(c);
    if (!body || typeof body !== "object" || !Array.isArray((body as GridSchema).columns)) {
      throw new HttpError(400, "InputValidationError", "Body must be a GridSchema");
    }
    return c.json(await gridOp<GridSchema>(deps.gridId, "updateSchema", body, context(c)));
  });

  app.post("/import", async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File))
      throw new HttpError(
        400,
        "InputValidationError",
        "multipart field `file` is required",
      );
    const str = (v: unknown) =>
      typeof v === "string" && v !== "" ? v : undefined;
    const { ds, access, schema } = await requestScope(c, str(form.grid) ?? deps.gridId);
    const jobId = await startImport(jobs, {
      file,
      mappingJson: str(form.mapping),
      mode: str(form.mode),
      keyColumnId: str(form.keyColumnId),
      schema,
      registry,
      access,
      dataSource: ds,
      tz: deps.tz,
    });
    return c.json({ jobId }, 202);
  });

  app.get("/import/:id", (c) => {
    const status = jobs.status(c.req.param("id"));
    if (!status) throw new HttpError(404, "NotFound", "Unknown import job");
    return c.json(status);
  });

  app.get("/import/:id/errors.csv", (c) => {
    const csv = jobs.errorCsv(c.req.param("id"));
    if (csv === undefined)
      throw new HttpError(404, "NotFound", "Unknown import job");
    return c.body(csv, 200, {
      "content-type": "text/csv;charset=utf-8",
      "content-disposition": `attachment; filename="import-errors-${c.req.param("id")}.csv"`,
    });
  });

  app.get("/export", async (c) => {
    const format = c.req.query("format") ?? "csv";
    if (format !== "csv" && format !== "xlsx")
      throw new HttpError(
        400,
        "InputValidationError",
        "format must be csv or xlsx",
      );
    const filter =
      parseJsonParam<FilterNode | null>(
        c.req.query("viewFilter"),
        "viewFilter",
      ) ?? null;
    const sort = parseJsonParam<SortSpec[]>(c.req.query("sort"), "sort") ?? [];
    const columns = parseJsonParam<ColumnState[]>(
      c.req.query("columns"),
      "columns",
    );
    const search = c.req.query("search");
    const gridId = c.req.query("grid") ?? deps.gridId;
    const { ds, access, schema } = await requestScope(c, gridId);
    const res = await buildExportResponse(
      {
        format,
        query: { filter, sort, ...(search ? { search } : {}) },
        ...(columns ? { columns } : {}),
        fileName: c.req.query("fileName") ?? gridId,
      },
      { dataSource: ds, schema, registry, access, tz: deps.tz },
    );
    return c.body(res.body, 200, {
      "content-type": res.contentType,
      "content-disposition": `attachment; filename="${res.fileName}"`,
    });
  });

  app.post("/__reset", async (c) => {
    const now = context(c).now;
    await deps.store.exclusive(() => resetGrid(env, deps.store, now()));
    await resetLeads(deps.db, leads, leadsTableName, now(), deps.tz);
    if ("clear" in leadsSchemaStore && typeof leadsSchemaStore.clear === "function") leadsSchemaStore.clear();
    return c.json({ ok: true });
  });

  return { app, jobs, grids };
}
