import type { DataSource, GridRow } from "@ranjeetk25/schema-grid-core";
import {
  createRemoteDataSource,
  type GridOperation,
  isWireError,
  RemoteDataSourceError,
  type RemoteDataSourceOptions,
} from "@ranjeetk25/schema-grid-core/wire";

export interface HttpDataSourceOptions extends RemoteDataSourceOptions {
  /** Base URL of the mounted grid endpoint, e.g. `/api/grid` or `https://api.example.com/grid`. */
  baseUrl: string;
  /** Fetch implementation. Default: the global `fetch`, resolved per request. */
  fetch?: typeof fetch;
  /** Extra headers per request (auth tokens, CSRF, tenant ids). */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Path appended to `baseUrl` for each operation. Default: `/${op}`. */
  opPath?: (op: GridOperation) => string;
  /** Only POST is supported: every op carries a JSON body. */
  method?: "POST";
  /** Forwarded to `fetch` (e.g. "include" for cookie sessions across origins). */
  credentials?: RequestCredentials;
}

function statusCode(status: number): string {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "PERMISSION_DENIED";
  return "HTTP_ERROR";
}

async function readJson(res: Response): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: (await res.json()) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * A `DataSource<GridRow>` that POSTs each operation as JSON to
 * `baseUrl + opPath(op)`. Expects `{ data }` on 2xx and `{ error: WireError }`
 * otherwise — the shape produced by `@ranjeetk25/schema-grid-server/http`.
 */
export function createHttpDataSource(options: HttpDataSourceOptions): DataSource<GridRow> {
  const base = options.baseUrl.replace(/\/+$/, "");
  const opPath = options.opPath ?? ((op: GridOperation) => `/${op}`);
  const customFetch = options.fetch;
  const getHeaders = options.headers;
  const method = options.method ?? "POST";
  const credentials = options.credentials;

  return createRemoteDataSource(
    async (op, input) => {
      const extra = getHeaders ? await getHeaders() : {};
      const init: RequestInit = {
        method,
        headers: { "content-type": "application/json", accept: "application/json", ...extra },
        body: JSON.stringify(input),
        ...(credentials ? { credentials } : {}),
      };
      // Called through a local binding so browsers don't throw "Illegal invocation".
      const doFetch = customFetch ?? globalThis.fetch;
      const res = await doFetch(`${base}${opPath(op)}`, init);
      const parsed = await readJson(res);
      if (!res.ok) {
        const error = parsed.ok ? (parsed.body as { error?: unknown } | null)?.error : undefined;
        throw new RemoteDataSourceError(
          isWireError(error) ? error : { code: statusCode(res.status), message: `HTTP ${res.status} for "${op}"` },
          res.status,
        );
      }
      const body = parsed.ok ? parsed.body : undefined;
      if (typeof body !== "object" || body === null || !("data" in body)) {
        throw new RemoteDataSourceError({
          code: "OUTPUT_INVALID",
          message: `Expected a { data } JSON body for "${op}"`,
        });
      }
      return (body as { data: unknown }).data;
    },
    {
      ...(options.supports ? { supports: options.supports } : {}),
      ...(options.validateOutput !== undefined ? { validateOutput: options.validateOutput } : {}),
    },
  );
}
