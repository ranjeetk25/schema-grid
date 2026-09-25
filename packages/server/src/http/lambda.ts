import { type GridRegistry, isGridRegistry } from "../grid/registry";
import { type GridRouterAdapter, runRequest, toHttpResponse } from "./adapter";
import { notFoundReply, type RegistryOptionArgs, runRegistryRoute } from "./registry-routes";

/** The slice of an API Gateway (REST v1 / HTTP v2) proxy event the handler reads. */
export interface LambdaLikeEvent {
  pathParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
  /** REST API (v1) method. */
  httpMethod?: string;
  /** HTTP API (v2) method. */
  requestContext?: { http?: { method?: string } };
}

/** API Gateway proxy result. */
export interface LambdaLikeResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface LambdaHandlerOptions<Event, Ctx> {
  /** Path parameter holding the operation name. Default "op" (route `POST /grid/{op}` or `/grid/{gridId}/{op}`). */
  opParam?: string;
  /** Registry mode: path parameter holding the grid id. Default "gridId". */
  gridParam?: string;
  /** Builds the adapter context from the event (authorizer claims, headers, ...). */
  context?: (event: Event) => Ctx | Promise<Ctx>;
  /** Extra response headers (CORS, caching). */
  headers?: Record<string, string>;
}

type LambdaOptionArgs<Event, Ctx> = undefined extends Ctx
  ? [options?: LambdaHandlerOptions<Event, Ctx>]
  : [options: LambdaHandlerOptions<Event, Ctx> & { context: (event: Event) => Ctx | Promise<Ctx> }];

function decodeBody(event: LambdaLikeEvent): string | undefined {
  const raw = event.body ?? undefined;
  return raw !== undefined && event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
}

/**
 * AWS Lambda handler for API Gateway proxy integrations. Never rejects.
 *
 * - Single data source: `toLambdaHandler(createGridRouterAdapter(ds))` on `POST /grid/{op}`.
 * - Grid registry: `toLambdaHandler(registry, { context })` on `POST /grid/{gridId}/{op}`,
 *   `GET /grid/{gridId}/schema` (or `GET /grid/{gridId}`) and `GET /grid` (list).
 */
export function toLambdaHandler<Ctx = undefined, Event extends LambdaLikeEvent = LambdaLikeEvent>(
  target: GridRegistry<Ctx>,
  ...args: RegistryOptionArgs<Omit<LambdaHandlerOptions<Event, Ctx>, "context">, Event, Ctx>
): (event: Event) => Promise<LambdaLikeResult>;
export function toLambdaHandler<Ctx = undefined, Event extends LambdaLikeEvent = LambdaLikeEvent>(
  target: GridRouterAdapter<Ctx>,
  ...args: LambdaOptionArgs<Event, Ctx>
): (event: Event) => Promise<LambdaLikeResult>;
export function toLambdaHandler<Ctx, Event extends LambdaLikeEvent>(
  target: GridRouterAdapter<Ctx> | GridRegistry<Ctx>,
  options: LambdaHandlerOptions<Event, Ctx> = {},
): (event: Event) => Promise<LambdaLikeResult> {
  const opParam = options.opParam ?? "op";
  const context = options.context;
  const headers = { "content-type": "application/json", ...options.headers };
  const reply = (status: number, body: unknown): LambdaLikeResult => ({
    statusCode: status,
    headers: { ...headers },
    body: JSON.stringify(body),
  });

  if (isGridRegistry(target)) {
    const registry = target as GridRegistry<Ctx>;
    const gridParam = options.gridParam ?? "gridId";
    return async (event) => {
      const method = event.httpMethod ?? event.requestContext?.http?.method ?? "POST";
      const gridId = event.pathParameters?.[gridParam];
      let op = event.pathParameters?.[opParam];
      if (gridId !== undefined && op === undefined && method.toUpperCase() === "GET") op = "schema";
      const segments = gridId === undefined ? [] : [gridId, op ?? ""];
      const res =
        (await runRegistryRoute(
          registry,
          method,
          segments,
          () => decodeBody(event),
          context ? () => context(event) : undefined,
        )) ?? notFoundReply(segments.join("/"));
      return reply(res.status, res.body);
    };
  }

  const adapter = target as GridRouterAdapter<Ctx>;
  return async (event) => {
    const op = event.pathParameters?.[opParam] ?? "";
    const result = await runRequest(adapter, op, decodeBody(event), context ? () => context(event) : undefined);
    const response = toHttpResponse(result);
    return reply(response.status, response.body);
  };
}
