import type { GridSchema } from "../internal/core";

/**
 * Where a grid's editable schema lives (spec C6).
 * TODO(lane-b): replace with the core `SchemaStore` type once it lands; the shape is identical.
 */
export interface SchemaStore {
  /** The stored schema, or null when the grid has never been saved. */
  get(gridId: string): Promise<GridSchema | null>;
  put(gridId: string, schema: GridSchema): Promise<void>;
}

export interface MemorySchemaStore extends SchemaStore {
  /** Forgets every stored schema (tests, dev resets). */
  clear(): void;
}

const copy = (schema: GridSchema): GridSchema => structuredClone(schema);

/**
 * Process-local `SchemaStore` (deep copies in and out). The default for tests
 * and single-instance demos; use `createDrizzleSchemaStore` to share schemas
 * across processes.
 */
export function createMemorySchemaStore(initial: Record<string, GridSchema> = {}): MemorySchemaStore {
  const schemas = new Map<string, GridSchema>();
  for (const [gridId, schema] of Object.entries(initial)) schemas.set(gridId, copy(schema));
  return {
    async get(gridId) {
      const found = schemas.get(gridId);
      return found ? copy(found) : null;
    },
    async put(gridId, schema) {
      schemas.set(gridId, copy(schema));
    },
    clear() {
      schemas.clear();
    },
  };
}
