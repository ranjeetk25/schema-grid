import { join } from "node:path";
import {
  FIXTURE_NOW,
  createFixtureSchema,
} from "@ranjeetk25/schema-grid-core/testing";
import { createApp } from "./app";
import { bootstrap } from "./bootstrap";
import { DEFAULT_DATABASE_URL, connect, gridTables } from "./db";
import { ensureLeads, ensureLeadsStorage, leadsTable } from "./leads/table";
import { SchemaStore } from "./schema-store";

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
const clock = process.env.DEMO_NOW || FIXTURE_NOW;
const tz = process.env.DEMO_TZ || "Asia/Kolkata";
const gridId = process.env.GRID_ID || "admissions";
const schemaFile = join(import.meta.dir, "..", "data", "schema.json");

const { db } = connect(databaseUrl);
const tables = gridTables();
const persisted = SchemaStore.readPersisted(schemaFile);
const store = new SchemaStore(schemaFile, createFixtureSchema);
const bootNow = clock === "wall" ? new Date() : new Date(clock);

await bootstrap({ db, tables, gridId, tz }, store, persisted, bootNow);
await ensureLeads(db, leadsTable("leads"), "leads", bootNow, tz);
await ensureLeadsStorage(db);

const { app } = createApp({ db, tables, gridId, store, tz, clock });

Bun.serve({ port, fetch: app.fetch });
console.error(
  `demo-api listening on http://localhost:${port} (grids "${gridId}" + "leads", clock ${clock}, tz ${tz})`,
);
