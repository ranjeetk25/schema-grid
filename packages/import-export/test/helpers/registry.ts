/** Test field-type registry: core's real built-ins. */
import { createDefaultRegistry } from "@masai/schema-grid-core/field-types";
import type { FieldTypeRegistry } from "../../src/internal/core";

export function makeRegistry(): FieldTypeRegistry {
  return createDefaultRegistry();
}
