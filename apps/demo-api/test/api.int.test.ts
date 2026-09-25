/**
 * End-to-end HTTP tests against the running MySQL from docker-compose
 * (`SCHEMA_GRID_MYSQL_IT=1`). Uses the in-process Hono app on dedicated
 * `it_*` tables so the dev server's data is untouched.
 */
import type {
  ChangeFeedEntry,
  ChangeResult,
  FilterNode,
  GridRow,
  GridSchema,
  QueryResult,
} from "@masai/schema-grid-core";
import {
  FIXTURE_NOW,
  createFixtureSchema,
} from "@masai/schema-grid-core/testing";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CreatedApp, createApp } from "../src/app";
import {
  DEFAULT_DATABASE_URL,
  type Database,
  connect,
  gridTables,
  rawQuery,
} from "../src/db";
import { SchemaStore } from "../src/schema-store";

const SECTION_8_FILTER: FilterNode = {
  op: "and",
  children: [
    { columnId: "col_status", operator: "isNot", value: "paid" },
    {
      columnId: "col_callDate",
      operator: "isWithin",
      value: { relative: "yesterday" },
    },
  ],
};
const NEXT_DAY = new Date(
  new Date(FIXTURE_NOW).getTime() + 86_400_000,
).toISOString();

type Headers = Record<string, string>;

describe.skipIf(process.env.SCHEMA_GRID_MYSQL_IT !== "1")(
  "demo-api over HTTP (MySQL)",
  () => {
    let database: Database;
    let created: CreatedApp;
    const tables = gridTables({
      rowsTable: "it_grid_rows",
      changeLogTable: "it_grid_change_log",
    });

    const call = async <T>(
      method: string,
      path: string,
      body?: unknown,
      headers: Headers = {},
    ) => {
      const res = await created.app.request(path, {
        method,
        headers: { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      return {
        status: res.status,
        json: (text ? JSON.parse(text) : null) as T,
        headers: res.headers,
      };
    };
    /** Wire contract: the body IS the op input; `200 { data }` / `<status> { error }`. */
    const op = async <T>(name: string, body: unknown, headers: Headers = {}) => {
      const res = await call<{
        data?: T;
        error?: { code: string; message: string; details?: unknown };
      } | null>("POST", `/grid/${name}`, body, headers);
      return {
        status: res.status,
        json: res.json?.data as T,
        error: res.json?.error,
      };
    };
    const fetchIds = async (
      filter: FilterNode | null,
      headers: Headers = {},
    ) => {
      const res = await op<QueryResult<GridRow>>(
        "fetch",
        { filter, sort: [], page: { offset: 0, limit: 100 } },
        headers,
      );
      expect(res.status).toBe(200);
      return res.json.rows.map((r) => r.id);
    };
    const row = async (id: string, headers: Headers = {}) => {
      const res = await op<QueryResult<GridRow>>(
        "fetch",
        { filter: null, sort: [], page: { offset: 0, limit: 100 } },
        headers,
      );
      return res.json.rows.find((r) => r.id === id) as GridRow;
    };

    beforeAll(async () => {
      database = connect(process.env.DATABASE_URL || DEFAULT_DATABASE_URL);
      created = createApp({
        db: database.db,
        tables,
        gridId: "admissions",
        store: new SchemaStore(null, createFixtureSchema),
        tz: "Asia/Kolkata",
        clock: FIXTURE_NOW,
      });
      expect((await call("POST", "/__reset")).status).toBe(200);
    });

    afterAll(async () => {
      await database?.close();
    });

    it("§8: isNot Paid AND callDate within yesterday (IST) → r2 + r3 (empty status included)", async () => {
      expect(await fetchIds(SECTION_8_FILTER)).toEqual(["r2", "r3"]);
    });

    it("§8: the same saved filter reopened the next day (x-now +24h) still means 'yesterday'", async () => {
      // Yesterday is now 2026-09-25 IST; core's r1..r5 have no call on that day, so nothing matches.
      // (r2/r3 dropping out proves the window moved with the clock rather than being frozen.)
      expect(await fetchIds(SECTION_8_FILTER, { "x-now": NEXT_DAY })).toEqual(
        [],
      );
    });

    it("two-user conflict round trip + change feed", async () => {
      const A = { "x-user": "userA" };
      const B = { "x-user": "userB" };
      const cursor = (await op<ChangeFeedEntry>("getChanges", { since: "" }, A))
        .json.cursor;
      const v = (await row("r1", A)).version;
      expect((await row("r1", B)).version).toBe(v);

      const rb = await op<ChangeResult>(
        "applyChanges",
        {
          id: "it-b",
          changes: [
            {
              rowId: "r1",
              columnId: "col_name",
              prev: "Asha Verma",
              next: "Asha (B)",
            },
          ],
          baseVersions: { r1: v },
          source: "edit",
        },
        B,
      );
      expect(rb.json.applied).toHaveLength(1);

      const ra = await op<ChangeResult>(
        "applyChanges",
        {
          id: "it-a",
          changes: [
            {
              rowId: "r1",
              columnId: "col_name",
              prev: "Asha Verma",
              next: "Asha (A)",
            },
          ],
          baseVersions: { r1: v },
          source: "edit",
        },
        A,
      );
      expect(ra.json.applied).toEqual([]);
      expect(ra.json.conflicts).toHaveLength(1);
      const conflict = ra.json
        .conflicts[0] as ChangeResult["conflicts"][number];
      expect(conflict).toMatchObject({
        rowId: "r1",
        columnId: "col_name",
        serverValue: "Asha (B)",
        serverVersion: v + 1,
      });
      expect(conflict.updatedBy).toMatchObject({ id: "userB" });

      const overwrite = await op<ChangeResult>(
        "applyChanges",
        {
          id: "it-a2",
          changes: [
            {
              rowId: "r1",
              columnId: "col_name",
              prev: "Asha (B)",
              next: "Asha (A)",
            },
          ],
          baseVersions: { r1: conflict.serverVersion },
          source: "edit",
        },
        A,
      );
      expect(overwrite.json.applied).toHaveLength(1);

      const feed = await op<ChangeFeedEntry>(
        "getChanges",
        { since: cursor },
        B,
      );
      expect(feed.status).toBe(200);
      const r1 = feed.json.rows.find((r) => r.id === "r1");
      expect(r1?.cells.name).toBe("Asha (A)");
      expect(r1?.version).toBe(v + 2);
      expect(Number(feed.json.cursor)).toBeGreaterThan(Number(cursor));
    });

    it("counsellor: filtering on hidden col_notes → 403 PERMISSION_DENIED; fetched rows lack notes", async () => {
      const counsellor = { "x-user": "u2", "x-roles": "counsellor" };
      const res = await op(
        "fetch",
        {
          filter: { columnId: "col_notes", operator: "isNotEmpty" },
          sort: [],
          page: { offset: 0, limit: 10 },
        },
        counsellor,
      );
      expect(res.status).toBe(403);
      expect(res.error?.code).toBe("PERMISSION_DENIED");
      expect(
        (res.error?.details as { columnIds: string[] }).columnIds,
      ).toEqual(["col_notes"]);

      const rows = (
        await op<QueryResult<GridRow>>(
          "fetch",
          { filter: null, sort: [], page: { offset: 0, limit: 10 } },
          counsellor,
        )
      ).json.rows;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.cells).not.toHaveProperty("notes");
      expect((await row("r1")).cells).toHaveProperty("notes", "VIP applicant");
    });

    it("export CSV for a counsellor has 'Name' but never 'Internal notes'", async () => {
      const res = await created.app.request(
        `/export?format=csv&viewFilter=${encodeURIComponent(JSON.stringify(SECTION_8_FILTER))}`,
        {
          headers: { "x-roles": "counsellor" },
        },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toBe(
        'attachment; filename="admissions.csv"',
      );
      const csv = (await res.text()).replace(/^�/, "");
      const lines = csv.split("\r\n");
      expect(lines[0]?.split(",")).toContain("Name");
      expect(csv).not.toContain("Internal notes");
      expect(csv).not.toContain("Asked about EMI");
      expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual([
        "Bhavesh Rao",
        "Chitra Nair",
      ]);

      const admin = await (
        await created.app.request("/export?format=csv")
      ).text();
      expect(admin).toContain("Internal notes");
    });

    it("export honours view column state (hidden columns never appear)", async () => {
      const columns = [
        { id: "col_email", hidden: false, order: 1 },
        { id: "col_name", hidden: false, order: 0 },
        { id: "col_fee", hidden: true, order: 2 },
      ];
      const res = await created.app.request(
        `/export?format=csv&columns=${encodeURIComponent(JSON.stringify(columns))}`,
      );
      const header = (await res.text()).replace(/^�/, "").split("\r\n")[0];
      expect(header).toBe("Name,Email");
    });

    it("export XLSX writes typed cells: Fee is a number, Call date a date", async () => {
      const res = await created.app.request(
        `/export?format=xlsx&columns=${encodeURIComponent(
          JSON.stringify([
            { id: "col_name", hidden: false, order: 0 },
            { id: "col_fee", hidden: false, order: 1 },
            { id: "col_callDate", hidden: false, order: 2 },
          ]),
        )}&viewFilter=${encodeURIComponent(
          JSON.stringify({
            columnId: "col_name",
            operator: "startsWith",
            value: "Bhavesh",
          }),
        )}`,
      );
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await res.arrayBuffer());
      const sheet = wb.worksheets[0];
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Name",
        "Fee",
        "Call date",
      ]);
      const data = sheet?.getRow(2);
      expect(data?.getCell(1).value).toBe("Bhavesh Rao");
      expect(data?.getCell(2).value).toBe(60000);
      expect(data?.getCell(2).type).toBe(ExcelJS.ValueType.Number);
      expect(data?.getCell(3).value).toBeInstanceOf(Date);
    });

    it("import a small CSV → job reaches done with the right created count", async () => {
      const csv =
        "Name,Fee,Payment status\nImported One,1000,Paid\nImported Two,2500,Pending\nBroken,not-a-number,Paid\n";
      const form = new FormData();
      form.append("file", new File([csv], "leads.csv", { type: "text/csv" }));
      const res = await created.app.request("/import", {
        method: "POST",
        body: form,
      });
      expect(res.status).toBe(202);
      const { jobId } = (await res.json()) as { jobId: string };
      const status = await created.jobs.waitFor(jobId);
      expect(status).toMatchObject({
        state: "done",
        total: 3,
        processed: 3,
        errorCount: 1,
        report: { created: 2, updated: 0 },
      });

      const polled = await call<{ state: string; errorReportUrl?: string }>(
        "GET",
        `/import/${jobId}`,
      );
      expect(polled.json.state).toBe("done");
      expect(polled.json.errorReportUrl).toBe(`/import/${jobId}/errors.csv`);
      const errors = await (
        await created.app.request(`/import/${jobId}/errors.csv`)
      ).text();
      expect(errors).toContain("Broken");

      const ids = await fetchIds({
        columnId: "col_name",
        operator: "startsWith",
        value: "Imported",
      });
      expect(ids).toHaveLength(2);
    });

    it("createOption appends a slugged option and bumps schemaVersion", async () => {
      const before = (await call<GridSchema>("GET", "/schema")).json
        .schemaVersion;
      const res = await op<{ id: string; label: string }>("createOption", {
        columnId: "col_stage",
        label: "Interview Scheduled",
      });
      expect(res.json).toEqual({
        id: "interview_scheduled",
        label: "Interview Scheduled",
      });
      const schema = (await call<GridSchema>("GET", "/schema")).json;
      expect(schema.schemaVersion).toBe(before + 1);
      expect(
        await op("getOptions", { columnId: "col_stage", search: "interview" }),
      ).toMatchObject({
        json: [{ id: "interview_scheduled" }],
      });
    });

    it("PUT /schema adds/drops gc_<key> generated columns idempotently; 409 on stale version", async () => {
      const gcColumns = async () =>
        (
          await rawQuery<{ name: string }>(
            database.db,
            "SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'it_grid_rows' AND COLUMN_NAME LIKE 'gc\\_%'",
          )
        ).map((r) => r.name);
      const current = (await call<GridSchema>("GET", "/schema")).json;
      const indexed = {
        ...current,
        columns: current.columns.map((c) =>
          c.key === "fee" ? { ...c, indexed: true } : c,
        ),
      };
      const put = await call<GridSchema>("PUT", "/schema", indexed);
      expect(put.status).toBe(200);
      expect(put.json.schemaVersion).toBe(current.schemaVersion + 1);
      expect(await gcColumns()).toEqual(["gc_fee"]);
      expect(
        await fetchIds({ columnId: "col_fee", operator: "eq", value: 50000 }),
      ).toEqual(["r1"]);

      expect((await call("PUT", "/schema", indexed)).status).toBe(409);
      const invalid = await call<{ error: { name: string } }>(
        "PUT",
        "/schema",
        {
          ...put.json,
          columns: [...put.json.columns, { ...put.json.columns[0], order: 99 }],
        },
      );
      expect(invalid.status).toBe(400);
      expect(invalid.json.error.name).toBe("SchemaValidationError");

      expect((await call("POST", "/__reset")).status).toBe(200);
      expect(await gcColumns()).toEqual([]);
      expect(
        (await call<GridSchema>("GET", "/schema")).json.schemaVersion,
      ).toBe(1);
      expect(await fetchIds(SECTION_8_FILTER)).toEqual(["r2", "r3"]);
    });
  },
);
