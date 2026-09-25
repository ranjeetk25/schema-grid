import { type GridRouterAdapter, runRequest, toHttpResponse } from "./adapter";

/** The slice of an API Gateway (REST v1 / HTTP v2) proxy event the handler reads. */
export interface LambdaLikeEvent {
  pathParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}

/** API Gateway proxy result. */
export interface LambdaLikeResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface LambdaHandlerOptions<Event, Ctx> {
  /** Path parameter holding the operation name. Default "op" (route `POST /grid/{op}`). */
  opParam?: string;
  /** Builds the adapter context from the event (authorizer claims, headers, ...). */
  context?: (event: Event) => Ctx | Promise<Ctx>;
  /** Extra response headers (CORS, caching). */
  headers?: Record<string, string>;
}

type LambdaOptionArgs<Event, Ctx> = undefined extends Ctx
  ? [options?: LambdaHandlerOptions<Event, Ctx>]
  : [options: LambdaHandlerOptions<Event, Ctx> & { context: (event: Event) => Ctx | Promise<Ctx> }];

/** AWS Lambda handler for API Gateway proxy integrations. Never rejects. */
export function toLambdaHandler<Ctx = undefined, Event extends LambdaLikeEvent = LambdaLikeEvent>(
  adapter: GridRouterAdapter<Ctx>,
  ...args: LambdaOptionArgs<Event, Ctx>
): (event: Event) => Promise<LambdaLikeResult> {
  const options: LambdaHandlerOptions<Event, Ctx> = args[0] ?? {};
  const opParam = options.opParam ?? "op";
  const context = options.context;
  const headers = { "content-type": "application/json", ...options.headers };
  return async (event) => {
    const op = event.pathParameters?.[opParam] ?? "";
    const raw = event.body ?? undefined;
    const body = raw !== undefined && event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
    const result = await runRequest(adapter, op, body, context ? () => context(event) : undefined);
    const response = toHttpResponse(result);
    return { statusCode: response.status, headers: { ...headers }, body: JSON.stringify(response.body) };
  };
}
