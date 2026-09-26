---
"@ranjeetk25/schema-grid-core": patch
"@ranjeetk25/schema-grid-io": patch
"@ranjeetk25/schema-grid-server": patch
"@ranjeetk25/schema-grid-ag-grid": patch
"@ranjeetk25/schema-grid-ui-mantine": patch
"@ranjeetk25/schema-grid-ui-shadcn": patch
---

v0.3.1 — save feedback and integration fixes from the first consumer pages.

**Save feedback**

- The server's per-cell save errors (`ChangeResult.errors[].message`, e.g. "The student has not uploaded: X") are now shown: the failed cell carries the message as its tooltip (`title`), the live region announces the first message, and `<SchemaGridWorkbench>` (both kits) shows a dismissible "N changes failed" banner listing the distinct messages (max 5, then "and N more"), auto-dismissed after 8 s unless hovered. `onError` receives `{ kind: "save", op: "applyChanges", errors }`. Conflicts stay on the conflict prompt.

**Rows after a save**

- `ChangeResult.rows?: GridRow[]` (wire passthrough): the refreshed rows for every row in the batch, read after the write — formulas, `compute`, `mapRows` and projection applied. The in-memory source, `createDrizzleDataSource` and `createSqlViewDataSource` populate it (inside the write transaction).
- New optional operation `getRows` (`DataSource.getRows?(ids)`, wire `{ ids }` → `GridRow[]`), implemented by all three sources and the remote client.
- The grid upserts `result.rows` into the row store (computed columns update without polling). When a source omits them, `refetchAfterSave` (new `useSchemaGrid` / `<SchemaGrid>` / workbench prop; default true in server mode, false in client mode) fetches the affected ids through `getRows`. `handle.refreshRows(ids)` and the workbench slot context's `refreshRows(ids)` do the same on demand.

**No repeat confirmation on conflict overwrite**

- `ChangeBatch.resubmitOf?: string` (wire passthrough) marks a batch the edit controller re-submits after "Overwrite"; the original batch's `meta` is carried over. The workbench skips the host `beforeCellsChange` for such batches (the internal chain still runs) unless `confirmOnResubmit: true`.

**Server**

- `write.afterCommit(ctx, outcome)` on `createSqlViewDataSource` and `afterCommit` on `createDrizzleDataSource`: awaited after the transaction commits (never inside it); a throwing hook is reported through `onWarning` / `console.error` and never changes the result. Also fired for `createRows` (`{ created }`) and `deleteRows` (`{ deletedIds }`).
- `columns[key].sortExpr` / `filterExpr` on the SQL view: alternative expressions used for `ORDER BY` + keyset paging and for `WHERE`, so hot sort/filter keys can hit an index (see "Performance on existing tables" in the server README).
- Schema editability distinguishes "forbidden" from "unavailable": `SchemaStore.available?()` (the Drizzle store checks that its table exists, cached per instance), `defineGrid.schemaWritable?(ctx)`, `capabilities.schema.reason?: "forbidden" | "no-store" | "store-unavailable"`, and `updateSchema` answers `UNSUPPORTED_OPERATION` 501 (`details.reason: "schema-store-unavailable"`) instead of 403 when the store is missing or unavailable. The workbench shows why column changes are unavailable.

**Options**

- `Option.settableBy: { roles: [] }` reads "Option “X” can’t be set manually" (was "…by nobody"); `Option.settableMessage` overrides the message everywhere the rule fires (core, server, editors, paste).

**io**

- `@ranjeetk25/schema-grid-io` and its `./export` subpath gain a `browser` export condition whose build contains no `node:` specifier (Blob writers only; `buildExportStream` throws "not available in the browser"). Vite no longer warns about `node:stream`. The default / Node entry is unchanged.

**Docs**

- `docs/upgrading.md` (0.2 → 0.3 Express strict-JSON note, 0.3 → 0.3.1), wire contract (`getRows`, `rows`, `resubmitOf`).
