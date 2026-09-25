import {
  type Access,
  type ColumnState,
  type DataSource,
  type FieldTypeRegistry,
  type FilterNode,
  type GridRow,
  type GridSchema,
  type LinkRef,
  type Option,
  type PermissionResolver,
  type PermissionUser,
  type SortSpec,
  createRolePermissionResolver,
} from "@masai/schema-grid-core";
import { createDefaultRegistry } from "@masai/schema-grid-core/field-types";
import {
  FIXTURE_USERS,
  createFixtureLinkTargets,
  createFixtureRows,
} from "@masai/schema-grid-core/testing";
import {
  assertValidSchema,
  createServerContext,
  resolveAccess,
} from "@masai/schema-grid-server";
import {
  type GridDb,
  type GridTables,
  createDrizzleDataSource,
  formulaTranslatability,
} from "@masai/schema-grid-server/drizzle";
import {
  createGridRouterAdapter,
  parseJsonBody,
  toHttpResponse,
} from "@masai/schema-grid-server/http";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type GridEnv, applyGeneratedColumns, resetGrid } from "./bootstrap";
import { buildExportResponse } from "./export";
import { HttpError, toErrorResponse } from "./http-error";
import { ImportJobs, startImport } from "./import-jobs";
import type { SchemaStore } from "./schema-store";

export interface AppDeps {
  db: GridDb;
  tables: GridTables;
  gridId: string;
  store: SchemaStore;
  /** IANA zone for relative dates. */
  tz: string;
  /** Default clock: an ISO instant, or "wall" for the real clock. Overridable per request with `x-now`. */
  clock: string;
  jobs?: ImportJobs;
  registry?: FieldTypeRegistry;
  resolver?: PermissionResolver;
  /** Override the per-request grid data source (tests). Default: Drizzle over MySQL. */
  dataSource?: (ctx: GridRequestContext) => DataSource<GridRow>;
}

/** Per-request identity + clock, read from `x-user` / `x-roles` / `x-now`. */
export interface GridRequestContext {
  user: PermissionUser;
  now: () => Date;
}

export interface CreatedApp {
  app: Hono;
  jobs: ImportJobs;
}

/** Display names for the fixture users (FIXTURE_USERS carries ids/roles only). */
function fixtureUserOptions(): Option[] {
  const names = new Map<string, string>();
  for (const row of createFixtureRows()) {
    const owner = row.cells.owner as
      | { id: string; name?: string }
      | null
      | undefined;
    if (owner?.name) names.set(owner.id, owner.name);
  }
  return Object.entries(FIXTURE_USERS).map(([role, u]) => ({
    id: u.id,
    label: names.get(u.id) ?? role,
  }));
}

function slugify(label: string): string {
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "option";
}

function parseJsonParam<T>(
  value: string | undefined,
  name: string,
): T | undefined {
  if (value === undefined || value === "") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new HttpError(
      400,
      "InputValidationError",
      `${name} must be URL-encoded JSON`,
    );
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(
      400,
      "InputValidationError",
      "Request body must be JSON",
    );
  }
}

export function createApp(deps: AppDeps): CreatedApp {
  const registry = deps.registry ?? createDefaultRegistry();
  const resolver = deps.resolver ?? createRolePermissionResolver();
  const jobs = deps.jobs ?? new ImportJobs();
  const env: GridEnv = {
    db: deps.db,
    tables: deps.tables,
    gridId: deps.gridId,
    tz: deps.tz,
  };
  const linkTargets = createFixtureLinkTargets();
  const userOptions = fixtureUserOptions();

  const userOf = (c: Context): PermissionUser => {
    const rolesHeader = c.req.header("x-roles");
    const roles =
      rolesHeader === undefined
        ? ["admin"]
        : rolesHeader
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean);
    return { id: c.req.header("x-user")?.trim() || "admin", roles };
  };

  const nowOf = (c: Context): (() => Date) => {
    const header = c.req.header("x-now");
    const iso = header ?? deps.clock;
    if (iso === "wall") return () => new Date();
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) {
      throw new HttpError(
        400,
        "InputValidationError",
        header
          ? "x-now must be an ISO instant"
          : "DEMO_NOW is not an ISO instant",
      );
    }
    return () => at;
  };

  const createOption = (columnId: string, label: string): Promise<Option> =>
    deps.store.exclusive(async () => {
      const schema = deps.store.get();
      const column = schema.columns.find((col) => col.id === columnId);
      const options = (
        column?.config as { options?: Option[] } | null | undefined
      )?.options;
      if (!column || !Array.isArray(options)) {
        throw new HttpError(
          400,
          "InputValidationError",
          `Column "${columnId}" does not hold options`,
        );
      }
      const existing = options.find(
        (o) => o.label.trim().toLowerCase() === label.trim().toLowerCase(),
      );
      if (existing) return existing;
      const base = slugify(label);
      let id = base;
      for (let n = 2; options.some((o) => o.id === id); n++)
        id = `${base}_${n}`;
      const option: Option = { id, label: label.trim() };
      const at = new Date().toISOString();
      const next: GridSchema = {
        ...schema,
        schemaVersion: schema.schemaVersion + 1,
        columns: schema.columns.map((col) =>
          col.id === columnId
            ? {
                ...col,
                config: {
                  ...(col.config as object),
                  options: [...options, option],
                },
                updatedAt: at,
              }
            : col,
        ),
      };
      assertValidSchema(next, registry, {
        physicalColumns: [],
        isFormulaTranslatable: formulaTranslatability(),
      });
      deps.store.set(next);
      return option;
    });

  const linkLookup = async (
    columnId: string,
    search: string,
  ): Promise<LinkRef[]> => {
    const term = search.trim().toLowerCase();
    const all = linkTargets[columnId] ?? [];
    return term
      ? all.filter((l) => l.label.toLowerCase().includes(term))
      : [...all];
  };

  const userDirectory = async (
    search: string | undefined,
  ): Promise<Option[]> => {
    const term = search?.trim().toLowerCase();
    return term
      ? userOptions.filter((o) => o.label.toLowerCase().includes(term))
      : [...userOptions];
  };

  const drizzleDataSource = (ctx: GridRequestContext): DataSource<GridRow> =>
    createDrizzleDataSource({
      db: deps.db,
      gridId: deps.gridId,
      schema: deps.store.get(),
      registry,
      resolver,
      user: ctx.user,
      tz: deps.tz,
      now: ctx.now,
      tables: deps.tables,
      onCreateOption: createOption,
      linkLookup,
      userDirectory,
    });
  const dataSourceFor = deps.dataSource ?? drizzleDataSource;

  /** The adapter's `context(req)`: fake auth + clock from the request headers. */
  const context = (c: Context): GridRequestContext => ({
    user: userOf(c),
    now: nowOf(c),
  });

  /** Wire-contract endpoint (docs/wire-contract.md): `200 { data }` / `<status> { error: WireError }`. */
  const grid = createGridRouterAdapter<GridRequestContext>(dataSourceFor, {
    onError: (err, info) => {
      if (info.status >= 500) console.error(err);
    },
  });

  /** Per-request data source + the matching column access map. */
  const requestScope = (
    c: Context,
  ): {
    ds: DataSource<GridRow>;
    access: Map<string, Access>;
    schema: GridSchema;
    now: () => Date;
  } => {
    const schema = deps.store.get();
    const ctx = context(c);
    const ds = dataSourceFor(ctx);
    const access = resolveAccess(
      createServerContext({
        schema,
        registry,
        resolver,
        user: ctx.user,
        tz: deps.tz,
        now: ctx.now,
      }),
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

  app.post("/grid/:op", async (c) => {
    const op = c.req.param("op");
    let result: Awaited<ReturnType<typeof grid.handle>>;
    try {
      const body = parseJsonBody(await c.req.text());
      result = body.ok
        ? await grid.handle(op, body.value, context(c))
        : { ok: false, error: body.error, status: 400 };
    } catch (err) {
      // Context resolution (e.g. a malformed x-now) fails the same way `handle` would.
      result = grid.failure(err, op);
    }
    const { status, body } = toHttpResponse(result);
    return c.json(body, status as ContentfulStatusCode);
  });

  app.get("/schema", (c) => c.json(deps.store.get()));

  app.put("/schema", async (c) => {
    const body = (await readJson(c)) as GridSchema;
    if (!body || typeof body !== "object" || !Array.isArray(body.columns)) {
      throw new HttpError(
        400,
        "InputValidationError",
        "Body must be a GridSchema",
      );
    }
    const now = nowOf(c);
    const next = await deps.store.exclusive(async () => {
      const current = deps.store.get();
      if (
        typeof body.schemaVersion !== "number" ||
        body.schemaVersion < current.schemaVersion
      ) {
        throw new HttpError(
          409,
          "SchemaVersionConflict",
          `Schema is at version ${current.schemaVersion}`,
          {
            currentVersion: current.schemaVersion,
          },
        );
      }
      const candidate: GridSchema = {
        ...body,
        schemaVersion: current.schemaVersion + 1,
      };
      assertValidSchema(candidate, registry, {
        physicalColumns: [],
        isFormulaTranslatable: formulaTranslatability(),
      });
      await applyGeneratedColumns(env, current, candidate, now());
      deps.store.set(candidate);
      return candidate;
    });
    return c.json(next);
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
    const { ds, access, schema } = requestScope(c);
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
    const { ds, access, schema } = requestScope(c);
    const res = await buildExportResponse(
      {
        format,
        query: { filter, sort, ...(search ? { search } : {}) },
        ...(columns ? { columns } : {}),
        fileName: c.req.query("fileName") ?? deps.gridId,
      },
      { dataSource: ds, schema, registry, access, tz: deps.tz },
    );
    return c.body(res.body, 200, {
      "content-type": res.contentType,
      "content-disposition": `attachment; filename="${res.fileName}"`,
    });
  });

  app.post("/__reset", async (c) => {
    const now = nowOf(c);
    await deps.store.exclusive(() => resetGrid(env, deps.store, now()));
    return c.json({ ok: true });
  });

  return { app, jobs };
}
