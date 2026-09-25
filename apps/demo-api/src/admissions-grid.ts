import type {
  DataSource,
  FieldTypeRegistry,
  GridRow,
  GridSchema,
  LinkRef,
  Option,
  PermissionResolver,
} from "@ranjeetk25/schema-grid-core";
import { FIXTURE_USERS, createFixtureLinkTargets, createFixtureRows } from "@ranjeetk25/schema-grid-core/testing";
import { assertValidSchema } from "@ranjeetk25/schema-grid-server";
import {
  type GridDb,
  type GridTables,
  createDrizzleDataSource,
  formulaTranslatability,
} from "@ranjeetk25/schema-grid-server/drizzle";
import { type GridDefinition, type SchemaStore as GridSchemaStore, defineGrid } from "@ranjeetk25/schema-grid-server/http";
import { type GridEnv, applyGeneratedColumns } from "./bootstrap";
import type { GridRequestContext } from "./context";
import { HttpError } from "./http-error";
import type { SchemaStore } from "./schema-store";

export interface AdmissionsGridDeps {
  db: GridDb;
  tables: GridTables;
  gridId: string;
  /** The file-backed schema holder (data/schema.json). */
  store: SchemaStore;
  tz: string;
  registry: FieldTypeRegistry;
  resolver: PermissionResolver;
  /** Override the per-request data source (tests). Default: Drizzle over the JSON-cells rows table. */
  dataSource?: (ctx: GridRequestContext) => DataSource<GridRow>;
}

/** Display names for the fixture users (FIXTURE_USERS carries ids/roles only). */
function fixtureUserOptions(): Option[] {
  const names = new Map<string, string>();
  for (const row of createFixtureRows()) {
    const owner = row.cells.owner as { id: string; name?: string } | null | undefined;
    if (owner?.name) names.set(owner.id, owner.name);
  }
  return Object.entries(FIXTURE_USERS).map(([role, u]) => ({ id: u.id, label: names.get(u.id) ?? role }));
}

function slugify(label: string): string {
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "option";
}

const validation = () => ({ physicalColumns: [], isFormulaTranslatable: formulaTranslatability() });

/**
 * `defineGrid` view of the file-backed store: `put` only accepts the direct
 * successor of the current schema, so a concurrent `createOption` (which bumps
 * the version under `store.exclusive`) turns a racing `updateSchema` into a
 * 409 instead of a lost write.
 */
export function fileSchemaStore(store: SchemaStore): GridSchemaStore {
  return {
    get: async () => store.get(),
    put: (_gridId, schema) =>
      store.exclusive(async () => {
        const current = store.get();
        if (schema.schemaVersion !== current.schemaVersion + 1) {
          throw Object.assign(new Error(`Schema is at version ${current.schemaVersion}`), {
            code: "SCHEMA_CONFLICT",
            details: { currentVersion: current.schemaVersion },
          });
        }
        store.set(schema);
      }),
  };
}

/**
 * The JSON-cells fixture grid (core's admissions fixture on `grid_rows`):
 * Drizzle data source, schema in data/schema.json, `gc_<key>` generated
 * columns reconciled on every schema change.
 */
export function admissionsGrid(deps: AdmissionsGridDeps): GridDefinition<GridRequestContext> {
  const env: GridEnv = { db: deps.db, tables: deps.tables, gridId: deps.gridId, tz: deps.tz };
  const linkTargets = createFixtureLinkTargets();
  const userOptions = fixtureUserOptions();

  const createOption = (columnId: string, label: string): Promise<Option> =>
    deps.store.exclusive(async () => {
      const schema = deps.store.get();
      const column = schema.columns.find((col) => col.id === columnId);
      const options = (column?.config as { options?: Option[] } | null | undefined)?.options;
      if (!column || !Array.isArray(options)) {
        throw new HttpError(400, "InputValidationError", `Column "${columnId}" does not hold options`);
      }
      const existing = options.find((o) => o.label.trim().toLowerCase() === label.trim().toLowerCase());
      if (existing) return existing;
      const base = slugify(label);
      let id = base;
      for (let n = 2; options.some((o) => o.id === id); n++) id = `${base}_${n}`;
      const option: Option = { id, label: label.trim() };
      const at = new Date().toISOString();
      const next: GridSchema = {
        ...schema,
        schemaVersion: schema.schemaVersion + 1,
        columns: schema.columns.map((col) =>
          col.id === columnId
            ? { ...col, config: { ...(col.config as object), options: [...options, option] }, updatedAt: at }
            : col,
        ),
      };
      assertValidSchema(next, deps.registry, validation());
      deps.store.set(next);
      return option;
    });

  const linkLookup = async (columnId: string, search: string): Promise<LinkRef[]> => {
    const term = search.trim().toLowerCase();
    const all = linkTargets[columnId] ?? [];
    return term ? all.filter((l) => l.label.toLowerCase().includes(term)) : [...all];
  };

  const userDirectory = async (search: string | undefined): Promise<Option[]> => {
    const term = search?.trim().toLowerCase();
    return term ? userOptions.filter((o) => o.label.toLowerCase().includes(term)) : [...userOptions];
  };

  return defineGrid<GridRequestContext>({
    id: deps.gridId,
    schema: () => deps.store.get(),
    schemaStore: fileSchemaStore(deps.store),
    registry: deps.registry,
    validation: validation(),
    onSchemaChange: async (ctx, prev, next) => {
      await applyGeneratedColumns(env, prev, next, ctx.now());
    },
    source: (ctx, { schema }) =>
      deps.dataSource
        ? deps.dataSource(ctx)
        : createDrizzleDataSource({
            db: deps.db,
            gridId: deps.gridId,
            schema,
            registry: deps.registry,
            resolver: deps.resolver,
            user: ctx.user,
            tz: deps.tz,
            now: ctx.now,
            tables: deps.tables,
            onCreateOption: createOption,
            linkLookup,
            userDirectory,
          }),
  });
}
