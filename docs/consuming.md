# Consuming Schema Grid from npm

The packages are public on npmjs.com under the `@masai` scope, MIT-licensed, and
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
  express.json(),
  toExpressHandler(grid, { context: (req) => ({ user: req.user as PermissionUser }) }),
);
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

## CI / AWS CodePipeline + CodeBuild

The packages are on the **public** npm registry, so `bun install` in CodeBuild
needs nothing: no token, no `.npmrc`. Commit the updated `bun.lock` as usual and
keep `bun install --frozen-lockfile` in the buildspec.

If you later install through a private mirror (CodeArtifact, Verdaccio,
Artifactory), route only the scope through it:

```ini
# .npmrc (bun reads it too; or use bunfig.toml [install.scopes])
@masai:registry=https://<your-mirror>/npm/
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
