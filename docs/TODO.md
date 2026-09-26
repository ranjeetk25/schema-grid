# Backlog

Current release: **0.3.1** (all six `@ranjeetk25/schema-grid-*`). Items below are queued for the next patch/minor; none block the admissions integration.

## 0.3.2 — leftovers from the admissions integration (all additive)

1. **`CommitOutcome.batchId` / `source`** — `afterCommit` outcome lacks the batch id and source (audit rows lost `batchId`). Add both (undefined for create/delete). `packages/server/src/changes/after-commit.ts`, both data sources, README.
2. **Store availability + reset** — `ExtensionCellStore.available?()` (table-exists probe, cached) on `createExtensionCellStore`; `reset()`/`invalidate()` on both Drizzle stores to drop the cached probe; `createSqlViewDataSource` reports extension-table `MISSING_TABLE` through it.
3. **Request context in `afterCommit`** — hook receives `SqlViewContext`, not the host request ctx. Add `hostContext?: unknown` option on both data sources, passed through as `outcome.hostContext` (`AfterCommitHook<Host>`); registry-friendly (`defineGrid.source(ctx, …)` passes `ctx`). Keep `apps/demo-api/src/leads/grid.ts` ≤ 40 lines and byte-identical to `docs/consuming.md`.
4. **Workbench `describeError`** — save-failure banner dedupes by message text only; failures outside the viewport have no row/column label. Prop `describeError?: (err: ChangeError, { row?, column? }) => string`; default `"<column label> · row <id>: <message>"` for off-viewport rows; dedupe by resulting label. Both kits + tests.
5. **Workbench surfaces `schema.reason` `no-store` / `forbidden`** — only `store-unavailable` is shown today. Quiet status-bar note ("Columns are read-only: no schema store configured" / "…: you don't have permission"); both kits + WorkbenchStates story variants + tests.

Release: one `patch` changeset for all six (fixed group) → `bun run version` → local publish recipe (see `docs/releasing.md`; npm token must have NO IP allow-list) → push `--follow-tags` → notify the admissions session.

## Known gaps (older)

- Range-drag edge autoscroll not implemented (Playwright test marked expected-fail).
- Repo formatting not normalized (`bunx biome format --write .` — maintainer runs it).
- GitHub Actions blocked by the account billing lock → releases are local until cleared; `release.yml` is ready.
- Workbench main chunk ~1.56 MB (AG Grid + Mantine); exceljs/papaparse already lazy. See `docs/bundle.md`.
