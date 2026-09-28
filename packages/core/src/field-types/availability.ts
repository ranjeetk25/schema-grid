/**
 * v0.4.1 capability-gated field types: a link column needs a source that can
 * `lookup` records, a user column one that serves `options` (people search).
 * Column builders hide unavailable types, pickers show the reason instead of
 * calling, and servers refuse `updateSchema` adding or retyping such a column.
 */
import type { FieldTypeId } from "./ids";
import type { FieldTypeRegistry } from "./registry";
import type { FieldTypeRequirement } from "./types";

/** Anything carrying `lookup` / `options` (`DataSourceCapabilities`, `EffectiveCapabilities`). Absent = assumed available. */
export type FieldTypeCapabilitiesLike = { lookup?: boolean; options?: boolean } | null | undefined;

export interface FieldTypeAvailability {
  available: boolean;
  /** Why not (user-facing), when `available` is false. */
  reason?: string;
}

/** Built-in requirements, used when no registry is given (the built-in field types declare the same `requires`). */
const BUILTIN_REQUIREMENTS: Readonly<Record<string, readonly FieldTypeRequirement[]>> = {
  link: ["lookup"],
  user: ["options"],
};

const REQUIREMENT_REASONS: Record<FieldTypeRequirement, string> = {
  lookup: "Linking isn't set up for this grid",
  options: "Option search isn't set up for this grid",
};

/** Built-in types with a more specific reason than their requirement's. */
const TYPE_REASONS: Readonly<Record<string, string>> = {
  user: "People search isn't set up for this grid",
};

/**
 * Whether columns of `typeId` can work against a source with `capabilities`.
 * Requirements come from the registered field type's `requires` (custom types
 * declare theirs there), falling back to the built-ins (link → `lookup`,
 * user → `options`). Reasons: link → "Linking isn't set up for this grid",
 * user → "People search isn't set up for this grid".
 */
export function fieldTypeAvailability(
  typeId: FieldTypeId,
  capabilities: FieldTypeCapabilitiesLike,
  registry?: FieldTypeRegistry,
): FieldTypeAvailability {
  const requires = registry?.get(typeId)?.requires ?? BUILTIN_REQUIREMENTS[typeId] ?? [];
  const missing = requires.find((r) => capabilities?.[r] === false);
  if (!missing) return { available: true };
  return { available: false, reason: TYPE_REASONS[typeId] ?? REQUIREMENT_REASONS[missing] };
}

const UNAVAILABLE_DETAILS: Readonly<Record<string, string>> = {
  link: "this grid has no records to link to",
  user: "this grid has no people to pick from",
};

/**
 * The server's 400 message when `updateSchema` adds or retypes a column the
 * source can't back: `"<label>" can't be a link column: this grid has no
 * records to link to` (user: `...no people to pick from`; custom types:
 * `...this grid doesn't support it`).
 */
export function fieldTypeUnavailableMessage(label: string, typeId: FieldTypeId): string {
  const detail = UNAVAILABLE_DETAILS[typeId] ?? "this grid doesn't support it";
  return `"${label}" can't be a ${typeId} column: ${detail}`;
}
