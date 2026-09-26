# Consuming Schema Grid from npm

The packages are public on npmjs.com under the `@ranjeetk25` scope, MIT-licensed, and
released in lockstep: every `@ranjeetk25/schema-grid-*` package always has the same
version, so pin them all to the same number.

| Package | Runs in | What it is |
|---|---|---|
| `@ranjeetk25/schema-grid-core` | browser + Node | schemas, field types, filters, formulas, wire contract |
| `@ranjeetk25/schema-grid-io` | browser + Node | CSV/XLSX import/export, clipboard parsing |
| `@ranjeetk25/schema-grid-server` | Node | Drizzle/MySQL data source, permissions, HTTP adapters |
| `@ranjeetk25/schema-grid-ag-grid` | browser | `<SchemaGrid>` on AG Grid Community, `createHttpDataSource` |
| `@ranjeetk25/schema-grid-ui-mantine` | browser | Mantine v8 editors, filter/column builders, import/export UI |

All packages ship ESM + CJS builds with `.d.ts` types, and need Node >= 20.

## Install (admissions monorepo)

Frontend workspace (e.g. `public-ui`):

```bash
bun add @ranjeetk25/schema-grid-core @ranjeetk25/schema-grid-ag-grid @ranjeetk25/schema-grid-ui-mantine
# peers the frontend must provide (see the table below)
bun add ag-grid-community@^36 ag-grid-react@^36 @mantine/dates@^8 dayjs zod
# optional: CSV/XLSX export from the browser
bun add @ranjeetk25/schema-grid-io
```

Backend workspace (`api`):

```bash
bun add @ranjeetk25/schema-grid-core @ranjeetk25/schema-grid-server
# peers: drizzle-orm ^0.45 (see "Known gaps" below), mysql2 ^3, zod
```

`@ranjeetk25/schema-grid-ui-mantine` depends on `-ag-grid`, `-core` and `-io` itself,
so those three get installed with it at the matching version. They are listed
explicitly above because you import from them directly.

### Peer dependencies

Peers are not installed for you: your app provides them, so there is one copy of
React, Mantine, AG Grid and Zod.

| Package | Peer | Range | Notes |
|---|---|---|---|
| `-core` | `zod` | `^3.25 \|\| ^4` | |
| `-io` | none | | brings `papaparse` ^5.7 and `exceljs` ^4.4 as regular dependencies |
| `-server` | `drizzle-orm` | `^0.45.0` | only used by the `/drizzle` subpath |
| | `mysql2` | `^3.0.0` | optional |
| `-ag-grid` | `react`, `react-dom` | `^18.3.0` | |
| | `ag-grid-community`, `ag-grid-react` | `^36.0.0` | Community only, no Enterprise |
| | `@ranjeetk25/schema-grid-io` | `*` | optional, only for `exportCurrentView` |
| `-ui-mantine` | `react`, `react-dom` | `^18.3.0` | |
| | `@mantine/core`, `@mantine/hooks`, `@mantine/dates` | `^8.0.0` | |
| | `@mantine/notifications` | `^8.0.0` | optional (paste-report toast) |
| | `dayjs` | `^1.11.0` | |
| | `zod` | `^3.25 \|\| ^4` | |
| | plus `-ag-grid`'s peers | | `ag-grid-community`, `ag-grid-react` ^36 |

Known gaps in the admissions monorepo (checked 2026-09): `public-ui` has
`@mantine/core`/`hooks` ^8.3 and React 18.3, but not `@mantine/dates` or
`ag-grid-*`. `api` pins `drizzle-orm` ^0.41, below the `^0.45.0` peer of
`@ranjeetk25/schema-grid-server`. Either upgrade drizzle-orm in `api`, or use only
the non-Drizzle parts of `-server` (`/http` with your own `DataSource`) until
you do. `zod` resolves to 3.25.76 there, which satisfies `^3.25`.

## CSS

- **AG Grid**: nothing to import. The grid uses AG Grid's Theming API
  (`createSchemaGridTheme()`, or pass your own `theme`), which injects its own
  styles. Do not also import `ag-grid-community/styles/*.css`: mixing legacy CSS
  themes with the Theming API breaks the grid's look.
- **Mantine**: the usual Mantine v8 stylesheets, once, at your app root.

```ts
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css"; // only if you use notifications
```

The schema-grid packages ship no CSS files of their own.

## Minimal wiring

### Server (Express)

```ts
import express from "express";
import { createRolePermissionResolver, type PermissionUser } from "@ranjeetk25/schema-grid-core";
import { createDefaultRegistry } from "@ranjeetk25/schema-grid-core/field-types";
import { createDrizzleDataSource } from "@ranjeetk25/schema-grid-server/drizzle";
import { createGridRouterAdapter, toExpressHandler } from "@ranjeetk25/schema-grid-server/http";

const registry = createDefaultRegistry();
const resolver = createRolePermissionResolver();

const grid = createGridRouterAdapter((ctx: { user: PermissionUser }) =>
  createDrizzleDataSource({ db, gridId: "admissions", schema, registry, resolver, user: ctx.user }),
);

app.post(
  "/api/grid/:op",
  express.json({ strict: false }),
  toExpressHandler(grid, { context: (req) => ({ user: req.user as PermissionUser }) }),
);
```

**`express.json()` and bare JSON bodies.** The op input is the JSON value itself, and it is `null` for
`capabilities` / `getSchema`. Express's `express.json()` is strict by default: a body that does not start with
`{` or `[` is answered with **400** before the grid handler runs. Since v0.3 the browser client sends those
ops as a body-less POST (no `content-type`), which any parser lets through, and the Express adapters treat a
missing / empty / `{}` / raw `"null"` body as `null` for exactly those ops. Still, either pass
`{ strict: false }` on the grid path (above), or mount the grid router **before** the app-wide parser:

```ts
app.use("/api/grid", express.json({ strict: false }), toExpressRouter(grids, { context })); // grid first
app.use(express.json()); // everything else, strict as before
```

`db` is your Drizzle MySQL instance and `schema` is a `GridSchema`. The tables
come from `@ranjeetk25/schema-grid-server/ddl` (`createRowsTableDDL`,
`createChangeLogTableDDL`). Hono, AWS Lambda and tRPC variants are in
[`packages/server/README.md`](../packages/server/README.md).

### Browser

```tsx
import { SchemaGrid, createHttpDataSource } from "@ranjeetk25/schema-grid-ag-grid";
import { createMantineUiRegistry } from "@ranjeetk25/schema-grid-ui-mantine/editors";
import { createDefaultRegistry } from "@ranjeetk25/schema-grid-core/field-types";

// Module scope: SchemaGrid compares these by reference.
const registry = createDefaultRegistry();
const uiRegistry = createMantineUiRegistry({ fieldTypes: registry });
const dataSource = createHttpDataSource({ baseUrl: "/api/grid", credentials: "include" });

export function AdmissionsGrid({ schema, user }) {
  return (
    <SchemaGrid schema={schema} dataSource={dataSource} registry={registry} uiRegistry={uiRegistry} user={user} />
  );
}
```

Render it inside your existing `<MantineProvider>`.

## Expose an existing table in ≤ 40 lines

A grid over a table you already have is one `defineGrid()` call. This is the demo-api's leads grid,
verbatim ([`apps/demo-api/src/leads/grid.ts`](../apps/demo-api/src/leads/grid.ts) — a test keeps the two in
sync): a plain `leads(id, name, email, payment_status ENUM, call_date DATE, ai_verified BOOL, updated_at)`
table, no `cells` JSON, no version column. Columns added from the grid's "+" header are saved in a schema store and
their values in an extension cells table beside `leads` (both created once, see below).

```ts
import { type ColumnDef, createRolePermissionResolver, type GridSchema } from "@ranjeetk25/schema-grid-core";
import { createSqlViewDataSource, type ExtensionCellStore, type GridDb } from "@ranjeetk25/schema-grid-server/drizzle";
import { defineGrid, type SchemaStore } from "@ranjeetk25/schema-grid-server/http";
import { eq, sql } from "drizzle-orm";
import type { GridRequestContext } from "../context";
import type { LeadsTable } from "./table";

const at = "2026-09-01T00:00:00.000Z";
const col = (order: number, key: string, label: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef =>
  ({ id: key, key, label, type, config: {}, order, createdAt: at, updatedAt: at, ...extra });
const options = ["Paid", "Pending", "Failed"].map((label) => ({ id: label.toLowerCase(), label }));

export const leadsSchema: GridSchema = { id: "leads", schemaVersion: 1, columns: [
  col(0, "name", "Name", "text"),
  col(1, "email", "Email", "email"),
  col(2, "paymentStatus", "Payment status", "select", { config: { options } }),
  col(3, "callDate", "Call date", "date", { config: { displayFormat: "dmy", inputOrder: "DMY" } }),
  col(4, "aiVerified", "AI verified", "boolean", { settable: false, sortable: false }), // AI pipeline only; unindexed
  col(5, "contact", "Contact", "text", { settable: false, sortable: false }), // computed below: read-only, unfilterable
] };

type Deps = { db: GridDb; table: LeadsTable; tz: string; schemaStore: SchemaStore; extension: ExtensionCellStore };

/** The existing `leads` table as a grid; "+" columns live in `extension`. Only admins may change the schema. */
export const leadsGrid = ({ db, table: t, tz, schemaStore, extension }: Deps) => defineGrid<GridRequestContext>({
  id: "leads", schema: leadsSchema, schemaStore,
  permission: (ctx, op) => op !== "updateSchema" || ctx.user.roles.includes("admin"),
  source: (ctx, { schema }) => createSqlViewDataSource({
    db, schema, resolver: createRolePermissionResolver(), user: ctx.user, tz, now: ctx.now, extension,
    baseQuery: () => sql`select * from ${t}`, rowId: t.id, updatedAt: t.updatedAt,
    columns: { name: { expr: t.name, searchable: true }, email: { expr: t.email, searchable: true },
      paymentStatus: { expr: t.paymentStatus }, callDate: { expr: t.callDate }, aiVerified: { expr: t.aiVerified },
      contact: { compute: (row) => `${row.cells.name ?? ""} <${row.cells.email ?? ""}>` } },
    defaultCapabilities: { maxPageSize: 200 },
    write: { update: async (view, { rowId, changes }) => { // `view.db` is the batch transaction
      await view.db.update(t).set(Object.fromEntries(changes.map((c) => [c.columnId, c.next]))).where(eq(t.id, Number(rowId)));
      return { applied: changes, version: 0 }; // no version column: the source re-reads the row hash
    } },
  }),
});
```

Serve every grid from one endpoint (`POST /grid/:gridId/:op` — the schema is the `getSchema` op — and `GET /grid` to list grids):

```ts
import { createExtensionCellsTableDDL, createGridSchemasTableDDL } from "@ranjeetk25/schema-grid-server/ddl";
import { createDrizzleSchemaStore, createExtensionCellStore } from "@ranjeetk25/schema-grid-server/drizzle";
import { createGridRegistry, toFetchHandler } from "@ranjeetk25/schema-grid-server/http";

// On boot (idempotent `CREATE TABLE IF NOT EXISTS`):
await db.execute(sql.raw(createGridSchemasTableDDL({ table: "grid_schemas" }).sql));
await db.execute(sql.raw(createExtensionCellsTableDDL({ table: "grid_extension_cells" }).sql));

const schemaStore = createDrizzleSchemaStore({ db, table: "grid_schemas" });
const extension = createExtensionCellStore({ db, table: "grid_extension_cells" });
const grids = createGridRegistry([
  admissionsGrid(deps),
  leadsGrid({ db, table: leads, tz: "Asia/Kolkata", schemaStore, extension }),
]);
const endpoint = toFetchHandler(grids, { basePath: "/grid", context: (request) => contextFrom(request.headers) });
app.all("/grid/*", (c) => endpoint(c.req.raw)); // Hono; Bun.serve / Next.js route handlers take `endpoint` as is
```

`toExpressRouter(grids, { context })` (mount with `app.use("/grid", express.json({ strict: false }), …)` — before
the global `express.json()`, see "Server (Express)") and
`toLambdaHandler(grids, { context })` (routes `POST /grid/{gridId}/{op}`) serve the same routes. There is exactly one
way to read a schema: `POST /grid/:gridId/getSchema` (v0.3 removed the `GET /grid/:gridId/schema` alias). In the browser, one client per grid:

```ts
import { createGridClient } from "@ranjeetk25/schema-grid-ag-grid";

const leads = createGridClient({ baseUrl: "/grid", gridId: "leads", credentials: "include" });
const schema = await leads.getSchema(); // <SchemaGrid schema={schema} dataSource={leads.dataSource} … />
await leads.updateSchema({ ...schema, columns: [...schema.columns, newColumn] }); // needs a schemaStore
```

### A whole page in one component

For an admin page (views, filter, group, search, import/export, add column,
conflicts, polling) use the workbench instead of wiring `<SchemaGrid>` by hand:

```tsx
import { createGridClient } from "@ranjeetk25/schema-grid-ag-grid";
import { SchemaGridWorkbench } from "@ranjeetk25/schema-grid-ui-mantine"; // or -ui-shadcn

const leads = createGridClient({ baseUrl: "/api/grid", gridId: "leads" }); // module scope

export const LeadsPage = ({ user }) => (
  <div style={{ height: "calc(100dvh - 56px)" }}>
    <SchemaGridWorkbench client={leads} user={user} title="Leads" />
  </div>
);
```

Toolbar features follow the grid's capabilities; see the "One-component page"
section of the ui-mantine / ui-shadcn READMEs for the props.

### Hooking into the workbench (v0.3)

The page keeps its own logic through `events` — the same `SchemaGridEvents` the bare grid takes, merged with the
workbench's built-in handlers rather than replacing them:

```tsx
<SchemaGridWorkbench
  client={leads}
  user={user}
  events={{
    // host → internal: return false to veto, or a reduced / transformed batch. Changes you drop are
    // reported as `rejected` (never sent); `meta` you attach travels to the data source untouched.
    beforeCellsChange: async (batch) => ({
      ...batch,
      meta: { decisionMessage: "Approved from the review page" },
      changes: batch.changes.filter((c) => c.columnId !== "locked"),
    }),
    onCellsChange: (result) => audit(result.applied),     // fans out: host AND the workbench see it
    onConflict: (conflict) => log(conflict),               // the built-in conflict prompt still opens
  }}
  exportFileName={({ view, date }) => `leads-${view?.name ?? "all"}-${date.toISOString().slice(0, 10)}`}
/>
```

- **Schema editability is known up front.** `capabilities().schema` is `{ read, write }`; a grid registry answers it
  from `permission(ctx, "getSchema" | "updateSchema")` and whether the grid has a `schemaStore`. When `write` is
  false the workbench shows no "+ Add column", no header "Edit column… / Insert…" and no column panel
  (`features.addColumn` can still only turn it off).
- **Columns picker.** The toolbar's "Columns" button shows/hides and reorders columns; the result is the current
  view's `columnState`, so "Save view" persists it and switching views undoes it. Columns the user cannot read are
  never listed.
- **Per-option rules.** `Option.settableBy: "all" | { roles }` restricts who may SET a select option (existing
  values stay readable). Editors hide such options, paste/fill count them as errors, and both the in-memory source
  and the server reject them with `Option “Verified” can only be set by Admin`. Set it from the column panel's
  Options editor ("Who can set") or in the schema.
- **Silent rejection.** A data source (or a `beforeCellsChange` that drops changes) may answer
  `ChangeResult.rejected: CellChange[]`: not applied, not an error. The grid reverts the value with no error state;
  the status bar reads "N changes not saved"; `ClipboardReport.rejected` counts them. The "saved" counter counts
  applied cells only.
- **Change metadata.** `ChangeBatch.meta` / `CellChange.meta` (JSON) are ignored by validation and the client write
  check, reach `applyChanges` / `write.update`, and are echoed on `applied` / `rejected` / `conflicts`. The server
  change log stores `meta` when present (existing installs: `ALTER TABLE <change_log> ADD COLUMN meta JSON NULL`).
- **Export.** Quick export names the file `${gridId}-${view}-${YYYY-MM-DD}.csv` (slugified); `exportFileName`
  (string or function) overrides it. Export failures reach `onError` and an inline banner with Retry.
- **Bundle.** io, the Import wizard and the Export dialog load on first use; exceljs sits in its own chunk
  (`docs/bundle.md`).

## CI / AWS CodePipeline + CodeBuild

The packages are on the **public** npm registry (registry.npmjs.org), so
installing them needs no `.npmrc`, no registry override and no token: not on a
laptop and not in CodeBuild. They are not published to GitHub Packages. Commit
the updated `bun.lock` as usual and keep `bun install --frozen-lockfile` in the
buildspec.

Only if you later install through a private mirror (CodeArtifact, Verdaccio,
Artifactory) that proxies npmjs.com do you need an `.npmrc`, routing just the
scope through the mirror:

```ini
# .npmrc (bun reads it too; or use bunfig.toml [install.scopes])
@ranjeetk25:registry=https://<your-mirror>/npm/
//<your-mirror>/npm/:_authToken=${NPM_MIRROR_TOKEN}
```

Then provide `NPM_MIRROR_TOKEN` in CodeBuild from Secrets Manager or
Parameter Store (`env.secrets-manager` in the buildspec). For CodeArtifact, run
`aws codeartifact login --tool npm --domain <d> --repository <r>` in `pre_build`
instead of setting a static token.

## Testing a PR before it is released

When a schema-grid PR has the `preview` label, CI publishes snapshot builds
(version `0.0.0-pr<N>-<sha7>`, dist-tag `pr`) and comments the exact install
line on the PR:

```bash
# exact build, which is reproducible:
bun add @ranjeetk25/schema-grid-core@0.0.0-pr42-1a2b3c4 @ranjeetk25/schema-grid-ag-grid@0.0.0-pr42-1a2b3c4 @ranjeetk25/schema-grid-ui-mantine@0.0.0-pr42-1a2b3c4
# or the newest preview from ANY PR:
bun add @ranjeetk25/schema-grid-core@pr
```

Use the same version for every package. Do not merge an admissions change that
depends on a `0.0.0-pr…` version; switch back to a real release first.

## Upgrading

Every release has a `CHANGELOG.md` per package and a GitHub Release. Because
versions move in lockstep, upgrade all of them together:

```bash
bun add @ranjeetk25/schema-grid-core@latest @ranjeetk25/schema-grid-ag-grid@latest @ranjeetk25/schema-grid-ui-mantine@latest
```

While the version is `0.x`, a minor bump (`0.1` to `0.2`) may contain breaking
changes. The changelog says so when it does.
