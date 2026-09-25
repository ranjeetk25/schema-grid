import type { DataSource, GridRow } from "@masai/schema-grid-core";
import {
  CursorError,
  FilterValidationError,
  FormulaQueryLimitError,
  GroupingError,
  PermissionError,
  RowValidationError,
  type SchemaGridServerError,
  SchemaValidationError,
  UnsupportedOperatorError,
} from "@masai/schema-grid-server";
import { z } from "zod";

/** An error carrying its own HTTP status (bad input, unknown op, missing capability…). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    name: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = name;
  }
}

export interface ErrorBody {
  error: { name: string; message: string; details?: unknown };
}

const obj = z.record(z.unknown());

const bodies = {
  fetch: z.object({ query: obj }),
  applyChanges: z.object({ batch: obj }),
  createRows: z.object({ partials: z.array(obj) }),
  deleteRows: z.object({ ids: z.array(z.string()) }),
  getChanges: z.object({ since: z.string() }),
  getOptions: z.object({ columnId: z.string(), search: z.string().optional() }),
  createOption: z.object({
    columnId: z.string(),
    label: z.string().trim().min(1),
  }),
  lookup: z.object({ columnId: z.string(), search: z.string().default("") }),
} as const;

export type GridOp = keyof typeof bodies;
export const GRID_OPS = Object.keys(bodies) as GridOp[];

export function isGridOp(op: string): op is GridOp {
  return Object.hasOwn(bodies, op);
}

function unsupported(op: string): never {
  throw new HttpError(
    501,
    "NotImplemented",
    `This data source does not implement ${op}`,
  );
}

/**
 * Dispatches one `POST /grid/:op` call to the per-request data source and
 * returns the raw result JSON. Throws for bad input / server errors; map
 * them with `toErrorResponse`.
 */
export async function handleOp(
  ds: DataSource<GridRow>,
  op: string,
  body: unknown,
): Promise<unknown> {
  if (!isGridOp(op))
    throw new HttpError(404, "UnknownOp", `Unknown grid op "${op}"`);
  // TODO(wire): replace with createDataSourceHandler
  switch (op) {
    case "fetch": {
      const { query } = bodies.fetch.parse(body);
      return ds.fetch(query as never);
    }
    case "applyChanges": {
      const { batch } = bodies.applyChanges.parse(body);
      return ds.applyChanges(batch as never);
    }
    case "createRows": {
      const { partials } = bodies.createRows.parse(body);
      return ds.createRows(partials as never);
    }
    case "deleteRows": {
      const { ids } = bodies.deleteRows.parse(body);
      await ds.deleteRows(ids);
      return { ok: true };
    }
    case "getChanges": {
      const { since } = bodies.getChanges.parse(body);
      if (!ds.getChanges) unsupported(op);
      return ds.getChanges(since);
    }
    case "getOptions": {
      const { columnId, search } = bodies.getOptions.parse(body);
      if (!ds.getOptions) unsupported(op);
      return ds.getOptions(columnId, search);
    }
    case "createOption": {
      const { columnId, label } = bodies.createOption.parse(body);
      if (!ds.createOption) unsupported(op);
      return ds.createOption(columnId, label);
    }
    case "lookup": {
      const { columnId, search } = bodies.lookup.parse(body);
      if (!ds.lookup) unsupported(op);
      return ds.lookup(columnId, search);
    }
  }
}

const BAD_REQUEST: (new (...args: never[]) => Error)[] = [
  FilterValidationError,
  CursorError,
  SchemaValidationError,
  RowValidationError,
  UnsupportedOperatorError,
  GroupingError,
  FormulaQueryLimitError,
];

/** Error → HTTP status + `{ error: { name, message, details? } }`. */
export function toErrorResponse(err: unknown): {
  status: number;
  body: ErrorBody;
} {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      body: {
        error: {
          name: err.name,
          message: err.message,
          ...(err.details === undefined ? {} : { details: err.details }),
        },
      },
    };
  }
  if (err instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        error: {
          name: "InputValidationError",
          message: "Invalid request body",
          details: { issues: err.issues },
        },
      },
    };
  }
  if (err instanceof PermissionError) {
    return {
      status: 403,
      body: {
        error: { name: err.name, message: err.message, details: err.details },
      },
    };
  }
  if (BAD_REQUEST.some((cls) => err instanceof cls)) {
    const e = err as SchemaGridServerError;
    return {
      status: 400,
      body: { error: { name: e.name, message: e.message, details: e.details } },
    };
  }
  // io errors (ImportConfigError / SheetNotFoundError / HiddenColumnError) are matched by name
  // so this module stays free of the io package.
  if (
    err instanceof Error &&
    (err.name === "ImportConfigError" || err.name === "SheetNotFoundError")
  ) {
    return {
      status: 400,
      body: { error: { name: err.name, message: err.message } },
    };
  }
  if (err instanceof Error && err.name === "HiddenColumnError") {
    return {
      status: 403,
      body: { error: { name: err.name, message: err.message } },
    };
  }
  const name = err instanceof Error ? err.name : "Error";
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: { name, message } } };
}
