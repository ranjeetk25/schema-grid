---
"@ranjeetk25/schema-grid-core": minor
"@ranjeetk25/schema-grid-ag-grid": minor
"@ranjeetk25/schema-grid-server": minor
"@ranjeetk25/schema-grid-io": minor
"@ranjeetk25/schema-grid-ui-mantine": minor
"@ranjeetk25/schema-grid-ui-shadcn": minor
---

`<SchemaGridWorkbench>` in ui-mantine and ui-shadcn: a whole admin grid page in one component (header, saved views with a pluggable `viewStore`, filter + chips, group, search, undo/redo, import, export, add/edit column panel with ghost preview, conflict prompt, polling, status bar). Features are derived from the data source's capabilities and can only be switched off; built-in banners cover read-only sources, permission denied, network/offline (retry), unsupported operations and schema changes (reload). Accepts a grid client (`createGridClient`) or `dataSource` + `schema`.
