import { z } from "zod";
import type { FilterNode, FilterValue } from "../filter/types";
import type { GroupResult } from "../query/types";
import type { GridSchema } from "../schema/types";
import type { GridOperation, GridWireContract } from "./operations";

// Only APIs shared by zod ^3.25 and ^4 are used here (two-argument
// `z.record`, `z.lazy`, `.strict()`), so either major works as the peer.

/** A schema whose parsed output is `T` (input type left open for zod 3/4 compatibility). */
export type WireSchema<T> = z.ZodType<T>;

export type WireSchemas = {
  [Op in GridOperation]: {
    input: WireSchema<GridWireContract[Op]["input"]>;
    output: WireSchema<GridWireContract[Op]["output"]>;
  };
};

/**
 * zod 3 infers `z.unknown()` object keys as optional, which a required
 * `unknown` field in the contract types rejects. The runtime shape is the
 * same, so those few schemas are narrowed with this helper.
 */
function as<T>(schema: z.ZodTypeAny): WireSchema<T> {
  return schema as unknown as WireSchema<T>;
}

const id = z.string();
const cells = z.record(z.string(), z.unknown());

const filterPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const relativeDate = z.object({
  relative: z.enum([
    "today",
    "yesterday",
    "tomorrow",
    "thisWeek",
    "lastWeek",
    "thisMonth",
    "lastMonth",
    "lastNDays",
    "nextNDays",
  ]),
  n: z.number().optional(),
});
const filterValue: WireSchema<FilterValue> = z.union([
  filterPrimitive,
  z.array(filterPrimitive),
  z.object({ from: filterPrimitive, to: filterPrimitive }),
  relativeDate,
  z.object({ me: z.literal(true) }),
]);

/** Recursive filter AST. Depth is NOT limited here; data sources enforce it. */
export const filterNodeSchema: WireSchema<FilterNode> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(["and", "or"]), children: z.array(filterNodeSchema) }),
    z.object({ columnId: id, operator: z.string(), value: filterValue.optional() }),
  ]),
);

const aggregationId = z.enum(["count", "sum", "avg", "min", "max", "countEmpty", "countFilled"]);
const pageRequest = z.union([
  z.object({ offset: z.number().int().nonnegative(), limit: z.number().int().positive() }).strict(),
  z.object({ cursor: z.string(), limit: z.number().int().positive() }).strict(),
]);

export const gridQuerySchema = z.object({
  filter: filterNodeSchema.nullable(),
  sort: z.array(z.object({ columnId: id, dir: z.enum(["asc", "desc"]) })),
  search: z.string().optional(),
  groupBy: z
    .array(
      z.object({
        columnId: id,
        aggregations: z.array(z.object({ columnId: id, agg: aggregationId })).optional(),
      }),
    )
    .optional(),
  page: pageRequest,
  includeTotal: z.boolean().optional(),
});

const actorRef = z.object({ id, name: z.string().optional() });

export const gridRowSchema = z.object({
  id,
  version: z.number(),
  updatedAt: z.string(),
  updatedBy: actorRef.optional(),
  cells,
});

const groupResult: WireSchema<GroupResult> = z.lazy(() =>
  as<GroupResult>(
    z.object({
      columnId: id,
      value: z.unknown(),
      key: z.string(),
      count: z.number(),
      aggregates: z.array(
        z.object({ columnId: id, agg: aggregationId, value: z.union([z.number(), z.string(), z.null()]) }),
      ),
      children: z.array(groupResult).optional(),
    }),
  ),
);

const cellChange = z.object({ rowId: id, columnId: id, prev: z.unknown(), next: z.unknown() });

const changeBatch = z.object({
  id,
  changes: z.array(cellChange),
  baseVersions: z.record(z.string(), z.number()),
  source: z.enum(["edit", "paste", "fill", "undo", "redo", "import"]),
});

const changeResult = z.object({
  applied: z.array(cellChange),
  conflicts: z.array(
    z.object({
      rowId: id,
      columnId: id,
      serverValue: z.unknown(),
      serverVersion: z.number(),
      updatedBy: actorRef.optional(),
      updatedAt: z.string(),
    }),
  ),
  errors: z.array(z.object({ rowId: id, columnId: id, message: z.string() })),
  versions: z.record(z.string(), z.number()).optional(),
});

const option = z.object({ id, label: z.string(), color: z.string().optional() });
const linkRef = z.object({ id, label: z.string() });

/**
 * Structural `GridSchema` check. Columns and views keep unknown keys (newer
 * column options survive a round trip); semantic validation (field-type
 * configs, formulas, permissions) is the server's `assertValidSchema`.
 */
export const gridSchemaSchema: WireSchema<GridSchema> = as<GridSchema>(
  z
    .object({
      id,
      schemaVersion: z.number(),
      columns: z.array(
        z
          .object({
            id,
            key: z.string(),
            label: z.string(),
            type: z.string(),
            config: z.unknown(),
            order: z.number(),
            createdAt: z.string(),
            updatedAt: z.string(),
          })
          .passthrough(),
      ),
      views: z.array(z.object({ id, name: z.string() }).passthrough()).optional(),
    })
    .passthrough(),
);

/** Input/output schema for every grid operation (see `GridWireContract`). */
export const wireSchemas: WireSchemas = {
  fetch: {
    input: gridQuerySchema,
    output: z.object({
      rows: z.array(gridRowSchema),
      total: z.number().optional(),
      nextCursor: z.string().optional(),
      groups: z.array(groupResult).optional(),
    }),
  },
  applyChanges: {
    input: as<GridWireContract["applyChanges"]["input"]>(changeBatch),
    output: as<GridWireContract["applyChanges"]["output"]>(changeResult),
  },
  createRows: {
    input: z.object({ partials: z.array(z.object({ id: id.optional(), cells: cells.optional() })) }),
    output: z.array(gridRowSchema),
  },
  deleteRows: {
    input: z.object({ ids: z.array(id) }),
    output: z.null(),
  },
  getChanges: {
    input: z.object({ since: z.string() }),
    output: z.object({
      cursor: z.string(),
      rows: z.array(gridRowSchema),
      deletedRowIds: z.array(id),
      schemaVersion: z.number(),
    }),
  },
  getOptions: {
    input: z.object({ columnId: id, search: z.string().optional() }),
    output: z.array(option),
  },
  createOption: {
    input: z.object({ columnId: id, label: z.string() }),
    output: option,
  },
  lookup: {
    input: z.object({ columnId: id, search: z.string() }),
    output: z.array(linkRef),
  },
  getSchema: {
    // `null` on the wire; an absent body (undefined) is accepted and normalised to null.
    input: as<null>(z.null().optional().transform(() => null)),
    output: gridSchemaSchema,
  },
  updateSchema: {
    input: gridSchemaSchema,
    output: gridSchemaSchema,
  },
};
