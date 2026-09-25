# schema-grid

[![CI](https://github.com/ranjeetk25/schema-grid/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ranjeetk25/schema-grid/actions/workflows/ci.yml)
[![Release](https://github.com/ranjeetk25/schema-grid/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/ranjeetk25/schema-grid/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@ranjeetk25/schema-grid-core?label=%40ranjeetk25%2Fschema-grid-core)](https://www.npmjs.com/package/@ranjeetk25/schema-grid-core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Schema Grid is a schema-driven, Airtable-style data grid built as a thin layer
over AG Grid **Community**. You describe the columns once as a typed schema:
field types, options, formulas and per-role permissions. From that schema you
get editing, filtering, sorting, grouping, range selection, clipboard, a fill
handle, undo/redo, CSV/XLSX import and export, and a column/filter builder UI.
The same schema drives a permission-checked Drizzle/MySQL backend, so the server
enforces what the grid shows. No AG Grid Enterprise licence is needed.

## Packages

All packages are released together and always share one version.

| Package | Version | What it is |
|---|---|---|
| [`@ranjeetk25/schema-grid-core`](packages/core) | [![npm](https://img.shields.io/npm/v/@ranjeetk25/schema-grid-core)](https://www.npmjs.com/package/@ranjeetk25/schema-grid-core) | schema, field types, filters, formulas, wire contract. No UI dependencies. |
| [`@ranjeetk25/schema-grid-io`](packages/import-export) | [![npm](https://img.shields.io/npm/v/@ranjeetk25/schema-grid-io)](https://www.npmjs.com/package/@ranjeetk25/schema-grid-io) | CSV/XLSX import and export, clipboard parsing |
| [`@ranjeetk25/schema-grid-server`](packages/server) | [![npm](https://img.shields.io/npm/v/@ranjeetk25/schema-grid-server)](https://www.npmjs.com/package/@ranjeetk25/schema-grid-server) | Drizzle/MySQL data source, permissions, change feed, HTTP adapters |
| [`@ranjeetk25/schema-grid-ag-grid`](packages/ag-grid) | [![npm](https://img.shields.io/npm/v/@ranjeetk25/schema-grid-ag-grid)](https://www.npmjs.com/package/@ranjeetk25/schema-grid-ag-grid) | `<SchemaGrid>` on AG Grid Community: column compiler, editors, range selection, clipboard, fill handle |
| [`@ranjeetk25/schema-grid-ui-mantine`](packages/ui-mantine) | [![npm](https://img.shields.io/npm/v/@ranjeetk25/schema-grid-ui-mantine)](https://www.npmjs.com/package/@ranjeetk25/schema-grid-ui-mantine) | Mantine v8 editors, filter/column builders, import wizard, export dialog |

## Quick start

```bash
bun add @ranjeetk25/schema-grid-core @ranjeetk25/schema-grid-ag-grid @ranjeetk25/schema-grid-ui-mantine \
  ag-grid-community ag-grid-react @mantine/core @mantine/hooks @mantine/dates dayjs zod
```

```tsx
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import { SchemaGrid, createHttpDataSource } from "@ranjeetk25/schema-grid-ag-grid";
import { createDefaultRegistry } from "@ranjeetk25/schema-grid-core/field-types";
import { createMantineUiRegistry } from "@ranjeetk25/schema-grid-ui-mantine/editors";

const registry = createDefaultRegistry();
const uiRegistry = createMantineUiRegistry({ fieldTypes: registry });
const dataSource = createHttpDataSource({ baseUrl: "/api/grid" }); // served by @ranjeetk25/schema-grid-server/http

<SchemaGrid schema={schema} dataSource={dataSource} registry={registry} uiRegistry={uiRegistry} user={user} />;
```

For peer dependency ranges, server wiring, CSS and CI notes, see
[docs/consuming.md](docs/consuming.md).

**Storybook:** <https://ranjeetk25.github.io/schema-grid/> (once Pages is
enabled; see [docs/releasing.md](docs/releasing.md#d-make-the-repository-public))

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run lint
bun run storybook      # component explorer at http://localhost:6006
bun run dev:api        # demo API (needs `bun run db:up` for MySQL)
```

- Contributing and changesets: [CONTRIBUTING.md](CONTRIBUTING.md)
- Releasing to npm: [docs/releasing.md](docs/releasing.md)
- Design spec: `docs/superpowers/specs/`; wire contract:
  [docs/wire-contract.md](docs/wire-contract.md)

## License

[MIT](./LICENSE) © 2026 Masai School
