import type { FieldTypeId } from "./ids";
import type { AnyFieldType } from "./types";

export interface FieldTypeRegistry {
  register(type: AnyFieldType): void;
  get(id: FieldTypeId): AnyFieldType | undefined;
  list(): AnyFieldType[];
  has(id: FieldTypeId): boolean;
}

/**
 * Creates a `FieldTypeRegistry`, optionally seeded with `types` (registered
 * in order, so `list()` preserves that order).
 *
 * `register` throws on a duplicate id: registering two field types under the
 * same id is a programmer error (misconfigured setup), not a recoverable
 * runtime condition.
 */
export function createFieldTypeRegistry(types?: readonly AnyFieldType[]): FieldTypeRegistry {
  const byId = new Map<FieldTypeId, AnyFieldType>();

  function register(type: AnyFieldType): void {
    if (byId.has(type.id)) {
      throw new Error(`FieldType with id "${type.id}" is already registered`);
    }
    byId.set(type.id, type);
  }

  for (const type of types ?? []) {
    register(type);
  }

  return {
    register,
    get(id: FieldTypeId): AnyFieldType | undefined {
      return byId.get(id);
    },
    list(): AnyFieldType[] {
      return Array.from(byId.values());
    },
    has(id: FieldTypeId): boolean {
      return byId.has(id);
    },
  };
}
