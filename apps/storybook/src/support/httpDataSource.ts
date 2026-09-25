/**
 * Minimal fetch adapter for apps/demo-api's `POST /grid/:op` contract
 * (one JSON body per DataSource method, raw result JSON back, errors as
 * `{ error: { name, message } }` with a 4xx/5xx status).
 *
 * TODO(wire): replace with the shared client from `@masai/schema-grid-core/wire`
 * once that branch lands.
 */
import type {
  DataSource,
  GridRow,
  GridSchema,
  PermissionUser,
} from "@masai/schema-grid-core";

export const DEMO_API_URL =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.STORYBOOK_DEMO_API_URL ?? "http://localhost:3001";

export class HttpDataSourceError extends Error {
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
    throw new HttpDataSourceError(
      res.status,
      err?.name ?? "HttpError",
      err?.message ?? `HTTP ${res.status}`,
    );
  }
  return body as T;
}

export function createHttpDataSource(
  options: HttpClientOptions,
): DataSource<GridRow> {
  const base = options.baseUrl ?? DEMO_API_URL;
  const call = async <T>(op: string, body: unknown): Promise<T> =>
    readJson<T>(
      await fetch(`${base}/grid/${op}`, {
        method: "POST",
        headers: headers(options),
        body: JSON.stringify(body),
      }),
    );
  return {
    fetch: (query) => call("fetch", { query }),
    applyChanges: (batch) => call("applyChanges", { batch }),
    createRows: (partials) => call("createRows", { partials }),
    deleteRows: async (ids) => {
      await call("deleteRows", { ids });
    },
    getChanges: (since) => call("getChanges", { since }),
    getOptions: (columnId, search) => call("getOptions", { columnId, search }),
    createOption: (columnId, label) =>
      call("createOption", { columnId, label }),
    lookup: (columnId, search) => call("lookup", { columnId, search }),
  };
}

export async function fetchSchema(
  options: HttpClientOptions,
): Promise<GridSchema> {
  const base = options.baseUrl ?? DEMO_API_URL;
  return readJson<GridSchema>(
    await fetch(`${base}/schema`, { headers: headers(options) }),
  );
}

export async function putSchema(
  options: HttpClientOptions,
  schema: GridSchema,
): Promise<GridSchema> {
  const base = options.baseUrl ?? DEMO_API_URL;
  return readJson<GridSchema>(
    await fetch(`${base}/schema`, {
      method: "PUT",
      headers: headers(options),
      body: JSON.stringify(schema),
    }),
  );
}
