import { type GridRouterAdapter, runRequest, toHttpResponse } from "./adapter";
import { normalizeRequestBody } from "./body";

/** The slice of an Express (or Express-compatible) request the handler reads. */
export interface ExpressLikeRequest {
  body?: unknown;
  params?: Record<string, string | undefined>;
}

/** The slice of an Express response the handler writes. */
export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  json(body: unknown): unknown;
}

export interface ExpressHandlerOptions<Req, Ctx> {
  /** Route parameter holding the operation name. Default "op" (`router.post("/grid/:op", ...)`). */
  opParam?: string;
  /** Builds the adapter context (user, tenant, ...) from the request. */
  context?: (req: Req) => Ctx | Promise<Ctx>;
}

type ExpressOptionArgs<Req, Ctx> = undefined extends Ctx
  ? [options?: ExpressHandlerOptions<Req, Ctx>]
  : [options: ExpressHandlerOptions<Req, Ctx> & { context: (req: Req) => Ctx | Promise<Ctx> }];

/**
 * Express-style handler (`(req, res) => Promise<void>`, never rejects).
 * Needs a JSON body parser (or a raw string body). Mount with
 * `router.post("/grid/:op", toExpressHandler(adapter))`.
 */
export function toExpressHandler<Ctx = undefined, Req extends ExpressLikeRequest = ExpressLikeRequest>(
  adapter: GridRouterAdapter<Ctx>,
  ...args: ExpressOptionArgs<Req, Ctx>
): (req: Req, res: ExpressLikeResponse) => Promise<void> {
  const options: ExpressHandlerOptions<Req, Ctx> = args[0] ?? {};
  const opParam = options.opParam ?? "op";
  const context = options.context;
  return async (req, res) => {
    const op = req.params?.[opParam] ?? "";
    const result = await runRequest(adapter, op, normalizeRequestBody(op, req.body), context ? () => context(req) : undefined);
    const { status, body } = toHttpResponse(result);
    res.status(status).json(body);
  };
}

