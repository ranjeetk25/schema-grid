import type { GridRegistry } from "../grid/registry";
import { normalizeRequestBody } from "./body";
import type { ExpressLikeResponse } from "./express";
import { notFoundReply, pathSegments, type RegistryOptionArgs, runRegistryRoute } from "./registry-routes";

/** The slice of an Express request the router reads (`req.path` is relative to the mount point). */
export interface ExpressLikeRouterRequest {
  method?: string;
  path?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

export type ExpressLikeNext = (err?: unknown) => void;

export interface ExpressRouterOptions<Req, Ctx> {
  /** Builds the registry context (user, tenant, ...) from the request. */
  context?: (req: Req) => Ctx | Promise<Ctx>;
}

/**
 * Express-compatible middleware serving a grid registry. Mount it with a JSON
 * body parser: `app.use("/grid", express.json(), toExpressRouter(registry, { context }))`.
 * Routes: `POST /:gridId/:op` (incl. `getSchema`) and `GET /` (list). Other
 * paths go to `next()` (or 404 without one). Never rejects.
 */
export function toExpressRouter<Ctx = undefined, Req extends ExpressLikeRouterRequest = ExpressLikeRouterRequest>(
  registry: GridRegistry<Ctx>,
  ...args: RegistryOptionArgs<ExpressRouterOptions<Req, Ctx>, Req, Ctx>
): (req: Req, res: ExpressLikeResponse, next?: ExpressLikeNext) => Promise<void> {
  const options: ExpressRouterOptions<Req, Ctx> = args[0] ?? {};
  const context = options.context;
  return async (req, res, next) => {
    const path = req.path ?? req.url ?? "/";
    const segments = pathSegments(path);
    const reply = segments
      ? await runRegistryRoute(
          registry,
          req.method ?? "GET",
          segments,
          () => normalizeRequestBody(segments[1] ?? "", req.body),
          context ? () => context(req) : undefined,
        )
      : undefined;
    if (!reply && next) {
      next();
      return;
    }
    const { status, body } = reply ?? notFoundReply(path);
    res.status(status).json(body);
  };
}
