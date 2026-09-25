import {
  DEFAULT_TIME_ZONE,
  type FieldTypeRegistry,
  type GridSchema,
  type PermissionResolver,
  type PermissionUser,
} from "./internal/core";

export interface ServerWarning {
  code: "FORMULA_FALLBACK";
  columnIds: string[];
  rowCap: number;
}

export interface ServerContext {
  readonly schema: GridSchema;
  readonly registry: FieldTypeRegistry;
  readonly resolver: PermissionResolver;
  readonly user: PermissionUser;
  /** IANA zone used to resolve relative dates and local days. Default `Asia/Kolkata`. */
  readonly tz: string;
  readonly now: () => Date;
  readonly onWarning?: (w: ServerWarning) => void;
  /** Max candidate rows for in-memory formula fallback. Default 5000. */
  readonly formulaFallbackRowCap: number;
}

export interface ServerContextInput {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  resolver: PermissionResolver;
  user: PermissionUser;
  tz?: string;
  now?: () => Date;
  onWarning?: (w: ServerWarning) => void;
  formulaFallbackRowCap?: number;
}

export const DEFAULT_FORMULA_FALLBACK_ROW_CAP = 5000;

export function createServerContext(input: ServerContextInput): ServerContext {
  const ctx: ServerContext = {
    schema: input.schema,
    registry: input.registry,
    resolver: input.resolver,
    user: { id: input.user.id, roles: [...input.user.roles] },
    tz: input.tz ?? DEFAULT_TIME_ZONE,
    now: input.now ?? (() => new Date()),
    formulaFallbackRowCap: input.formulaFallbackRowCap ?? DEFAULT_FORMULA_FALLBACK_ROW_CAP,
    ...(input.onWarning ? { onWarning: input.onWarning } : {}),
  };
  return Object.freeze(ctx);
}
