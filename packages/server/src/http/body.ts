import { wireSchemas } from "../internal/core";

/** Operations whose wire input is `null` (their schema accepts null): a transport may send them with no body at all. */
const NULL_INPUT_OPS: ReadonlySet<string> = new Set(
  Object.entries(wireSchemas)
    .filter(([, s]) => s.input.safeParse(null).success)
    .map(([op]) => op),
);

/** True for ops such as `capabilities` and `getSchema` whose input is `null`. */
export function isNullInputOperation(op: string): boolean {
  return NULL_INPUT_OPS.has(op);
}

function isEmptyObject(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length === 0;
}

/**
 * Body tolerance for framework-parsed requests (Express-style `req.body`).
 * Clients post bare JSON (`null` for `capabilities` / `getSchema`), which
 * `express.json()` in strict mode rejects with 400 before the router runs; the
 * fix is a body-less request, and this maps what such a request looks like to
 * `null` for the null-input ops:
 * - no body (`undefined` / `null`, Express 5), an empty string, whitespace or
 *   the raw text `null` (`express.text()` or no parser),
 * - `{}` — what Express 4's `express.json()` leaves when there is no body.
 * Every other op and body is returned untouched (string bodies are parsed later
 * by `parseJsonBody`).
 */
export function normalizeRequestBody(op: string, body: unknown): unknown {
  if (!isNullInputOperation(op)) return body;
  if (body === undefined || body === null) return null;
  if (typeof body === "string" && (body.trim() === "" || body.trim() === "null")) return null;
  if (isEmptyObject(body)) return null;
  return body;
}
