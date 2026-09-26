/**
 * apps/demo-api client helpers. The grid itself talks to `POST /grid/:op`
 * through `createHttpDataSource` from `@ranjeetk25/schema-grid-ag-grid` (the wire
 * contract, docs/wire-contract.md); this file only builds its options (the
 * demo's fake-auth headers) and the grid-level schema ops (`getSchema` /
 * `updateSchema`), which are wire ops too (v0.3: the REST `/schema` aliases are gone).
 */
import {
  type HttpDataSourceOptions,
  createHttpDataSource,
} from "@ranjeetk25/schema-grid-ag-grid";
import type {
  DataSource,
  GridRow,
  GridSchema,
  PermissionUser,
} from "@ranjeetk25/schema-grid-core";

export const DEMO_API_URL =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.STORYBOOK_DEMO_API_URL ?? "http://localhost:3001";

export class DemoApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorName: string,
    message: string,
  ) {
    super(message);
    this.name = errorName;
  }
}

export interface HttpClientOptions {
  baseUrl?: string;
  user: PermissionUser;
  /** Optional clock override forwarded as `x-now` (the demo-api pins FIXTURE_NOW by default). */
  now?: string;
}

function headers(options: HttpClientOptions): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-user": options.user.id,
    "x-roles": options.user.roles.join(","),
    ...(options.now ? { "x-now": options.now } : {}),
  };
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (body as { error?: { name?: string; message?: string } } | null)
      ?.error;
    throw new DemoApiError(
      res.status,
      err?.name ?? "HttpError",
      err?.message ?? `HTTP ${res.status}`,
    );
  }
  return body as T;
}

/** The grid's data source: the wire-contract endpoint mounted at `${baseUrl}/grid`. */
export function createDemoDataSource(
  options: HttpClientOptions,
): DataSource<GridRow> {
  const http: HttpDataSourceOptions = {
    baseUrl: `${options.baseUrl ?? DEMO_API_URL}/grid`,
    headers: () => headers(options),
  };
  return createHttpDataSource(http);
}

/** One grid-level wire op on the demo's `admissions` grid (`POST /grid/admissions/:op`, `{ data }` envelope). */
async function schemaOp(
  options: HttpClientOptions,
  op: "getSchema" | "updateSchema",
  input: unknown,
): Promise<GridSchema> {
  const base = options.baseUrl ?? DEMO_API_URL;
  const body = await readJson<{ data: GridSchema }>(
    await fetch(`${base}/grid/admissions/${op}`, {
      method: "POST",
      headers: headers(options),
      body: JSON.stringify(input),
    }),
  );
  return body.data;
}

export async function fetchSchema(
  options: HttpClientOptions,
): Promise<GridSchema> {
  return schemaOp(options, "getSchema", null);
}

/** `updateSchema`: send the CURRENT `schemaVersion`; the registry bumps it. */
export async function putSchema(
  options: HttpClientOptions,
  schema: GridSchema,
): Promise<GridSchema> {
  return schemaOp(options, "updateSchema", schema);
}
