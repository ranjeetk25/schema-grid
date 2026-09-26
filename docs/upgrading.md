# Upgrading

All `@ranjeetk25/schema-grid-*` packages are released in lockstep: upgrade every
one of them (server, ag-grid, ui-*, io, core) to the same version in one change.
A mixed set is not supported; the wire contract lives in
[`wire-contract.md`](./wire-contract.md).

## 0.2 → 0.3

### Bare `null` bodies and `express.json()`

The op input is the JSON value itself, and it is `null` for `capabilities` and
`getSchema`. A **0.2 browser client** POSTs those two ops with the literal body
`null` and `content-type: application/json`. Express's `express.json()` is strict
by default: a body that does not start with `{` or `[` is answered with **400**
before the schema-grid wire layer ever runs, so the grid shows no schema and no
capabilities. Any one of these fixes it:

1. Turn strict mode off on the grid path, or mount the grid router before the
   app-wide parser (the "Server (Express)" wiring in
   [`consuming.md`](./consuming.md)):

   ```ts
   app.post("/api/grid/:op", express.json({ strict: false }), toExpressHandler(grid, { context }));
   // or, with several grids:
   app.use("/api/grid", express.json({ strict: false }), toExpressRouter(grids, { context })); // grid first
   app.use(express.json()); // everything else, strict as before
   ```

2. Upgrade the clients first. A **0.3 client** sends those ops as a body-less
   POST (no `content-type`), which any parser lets through.

3. Nothing else: v0.3 `toExpressRouter` / `toExpressHandler` already treat a
   missing, empty, `{}` or raw `"null"` body as `null` for exactly those ops.
   Only the strict parser's own 400 stands in the way.

### Removed: `GET /grid/:gridId/schema`

There is exactly one way to read a schema: `POST /grid/:gridId/getSchema`. The
`GET …/schema` alias is gone; anything that called it (curl scripts, health
checks, custom clients) must switch to the POST.

## 0.3 → 0.3.1

Additive; no wire or type breaks. In short:

- `ChangeResult.rows` / `getRows` — optional. A server may return the rows a
  batch produced; clients that ignore them are unaffected.
- `ChangeBatch.resubmitOf` — optional id of the batch this one replaces.
- `@ranjeetk25/schema-grid-io` ships a **browser build** under the `browser`
  export condition (`dist/index.browser.*`, `dist/export/index.browser.*`) that
  reaches no `node:` module. Same names as the Node entry; `buildExportStream`
  throws `"buildExportStream is not available in the browser; use
  buildExportBlob"` there and `buildExport` always returns a Blob. Bundlers
  that honour `browser` stop warning about `node:stream`. See
  [`bundle.md`](./bundle.md).
- Option copy: the read-only hint now reads "can't be set manually".
- `capabilities.schema.reason` — optional string explaining why the schema
  is not editable.
