import type { PermissionUser } from "@ranjeetk25/schema-grid-core";
import { HttpError } from "./http-error";

/** Per-request identity + clock, read from `x-user` / `x-roles` / `x-now` (fake auth). */
export interface GridRequestContext {
  user: PermissionUser;
  now: () => Date;
}

/** Anything with a `get(name)` header lookup (Web `Headers`, Hono's `c.req.header` wrapped). */
export interface HeaderLookup {
  get(name: string): string | null | undefined;
}

/**
 * Builds the grid context from request headers. `clock` is the default: an
 * ISO instant or "wall" (real clock). Throws `HttpError` 400 on a bad `x-now`.
 */
export function requestContext(headers: HeaderLookup, clock: string): GridRequestContext {
  const rolesHeader = headers.get("x-roles");
  const roles =
    rolesHeader === null || rolesHeader === undefined
      ? ["admin"]
      : rolesHeader
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean);
  const user: PermissionUser = { id: headers.get("x-user")?.trim() || "admin", roles };

  const header = headers.get("x-now") ?? undefined;
  const iso = header ?? clock;
  if (iso === "wall") return { user, now: () => new Date() };
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    throw new HttpError(
      400,
      "InputValidationError",
      header ? "x-now must be an ISO instant" : "DEMO_NOW is not an ISO instant",
    );
  }
  return { user, now: () => at };
}
