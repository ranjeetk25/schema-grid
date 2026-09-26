import type { GridRegistry } from "../grid/registry";
import { notFoundReply, pathSegments, type RegistryOptionArgs, runRegistryRoute } from "./registry-routes";

export interface FetchHandlerOptions<Ctx> {
  /** Path prefix the handler is mounted under, e.g. "/api/grid". Default "" (the whole path). */
  basePath?: string;
  /** Builds the registry context (user, tenant, clock, ...) from the request. */
  context?: (request: Request) => Ctx | Promise<Ctx>;
  /** Extra response headers (CORS, caching). */
  headers?: Record<string, string>;
}

function stripBase(pathname: string, basePath: string): string | undefined {
  const base = basePath.replace(/\/+$/, "");
  if (base === "") return pathname;
  if (pathname === base) return "/";
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : undefined;
}

/**
 * Web-standard handler (`Request → Response`) for a grid registry: works with
 * Hono (`app.all("/grid/*", (c) => handler(c.req.raw))`), Bun.serve, Next.js
 * route handlers, Deno and Cloudflare Workers. Routes (below `basePath`):
 * `POST /:gridId/:op` (incl. `getSchema` / `updateSchema`) and `GET /` (grids
 * the context may open). Answers `200 { data }` / `<status> { error: WireError }`. Never rejects.
 */
export function toFetchHandler<Ctx = undefined>(
  registry: GridRegistry<Ctx>,
  ...args: RegistryOptionArgs<FetchHandlerOptions<Ctx>, Request, Ctx>
): (request: Request) => Promise<Response> {
  const options: FetchHandlerOptions<Ctx> = args[0] ?? {};
  const basePath = options.basePath ?? "";
  const context = options.context;
  const headers = { "content-type": "application/json", ...options.headers };
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  return async (request) => {
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      pathname = request.url;
    }
    const relative = stripBase(pathname, basePath);
    const segments = relative === undefined ? undefined : pathSegments(relative);
    let reply = segments
      ? await runRegistryRoute(
          registry,
          request.method,
          segments,
          () => request.text(),
          context ? () => context(request) : undefined,
        )
      : undefined;
    reply ??= notFoundReply(pathname);
    return respond(reply.status, reply.body);
  };
}
