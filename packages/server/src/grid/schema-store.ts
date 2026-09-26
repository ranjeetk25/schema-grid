import type { GridSchema, SchemaStore } from "../internal/core";

/** Where a grid's editable schema lives (spec C6); the type is core's. */
export type { SchemaStore };

export interface MemorySchemaStore extends SchemaStore {
  /** Always true: the process-local store can always persist. */
  available(): Promise<boolean>;
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
    async available() {
      return true;
    },
    clear() {
      schemas.clear();
    },
  };
}
