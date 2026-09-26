import type { GridRegistry } from "../grid/registry";
import { httpStatusFor, type WireError, type WireResult } from "../internal/core";
import { parseJsonBody, toHttpResponse } from "./adapter";

/** `[options?]` when the registry context may be undefined, else options with a required `context`. */
export type RegistryOptionArgs<Options, Req, Ctx> = undefined extends Ctx
  ? [options?: Options & { context?: (req: Req) => Ctx | Promise<Ctx> }]
  : [options: Options & { context: (req: Req) => Ctx | Promise<Ctx> }];

export interface HttpReply {
  status: number;
  body: { data: unknown } | { error: WireError };
}

const failed = (code: string, message: string): WireResult => ({
  ok: false,
  error: { code, message },
  status: httpStatusFor(code),
});

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** Splits a (mount-relative) path into decoded, non-empty segments; undefined when malformed. */
export function pathSegments(path: string): string[] | undefined {
  const out: string[] = [];
  for (const raw of path.split("?")[0]?.split("/") ?? []) {
    if (raw === "") continue;
    const seg = decode(raw);
    if (seg === undefined) return undefined;
    out.push(seg);
  }
  return out;
}

/**
 * The multi-grid HTTP binding shared by every registry adapter:
 * `GET /` → list, `POST /:gridId/:op` → op (the schema is the `getSchema` op:
 * `POST /:gridId/getSchema`; v0.3 removed the `GET /:gridId/schema` alias).
 * Returns undefined when the path is not a grid route (let the framework 404).
 * Never throws.
 */
export async function runRegistryRoute<Ctx>(
  registry: GridRegistry<Ctx>,
  method: string,
  segments: string[],
  readBody: () => unknown,
  resolveContext: (() => Ctx | Promise<Ctx>) | undefined,
): Promise<HttpReply | undefined> {
  if (segments.length > 2 || segments.length === 1) return undefined;
  const verb = method.toUpperCase();
  const [gridId, op] = segments as [string?, string?];
  const isList = gridId === undefined;
  if (isList ? verb !== "GET" : verb !== "POST") {
    return toHttpResponse(failed("METHOD_NOT_ALLOWED", `${verb} is not allowed here`));
  }
  const opName = isList ? "list" : (op as string);
  try {
    const parsed = isList ? { ok: true as const, value: null } : parseJsonBody(await readBody());
    if (!parsed.ok) return toHttpResponse({ ok: false, error: parsed.error, status: httpStatusFor(parsed.error.code) });
    const ctx = resolveContext ? await resolveContext() : undefined;
    if (isList) {
      const list = registry.list as (ctx?: Ctx) => Promise<unknown>;
      return toHttpResponse({ ok: true, data: await list(ctx) });
    }
    const handle = registry.handle as (gridId: string, op: string, input: unknown, ctx?: Ctx) => Promise<WireResult>;
    // An empty body means "no input": getSchema expects null.
    const input = parsed.value === undefined ? null : parsed.value;
    return toHttpResponse(await handle(gridId as string, opName, input, ctx));
  } catch (err) {
    return toHttpResponse(registry.failure(err, opName));
  }
}

/** Reply for a path that is not a grid route (adapters without a fall-through). */
export function notFoundReply(path: string): HttpReply {
  return toHttpResponse(failed("UNKNOWN_OPERATION", `No grid route for "${path}"`));
}
