import type { StorageKind } from "../sql/storage-kind";
import { BOOLEAN_TRANSLATORS } from "./ops-boolean";
import { NUMBER_TRANSLATORS } from "./ops-number";
import { TEXT_TRANSLATORS } from "./ops-text";
import type { OperatorTranslator } from "./types";

const table = new Map<string, OperatorTranslator>();
const keyOf = (kind: StorageKind | string, operatorId: string) => `${kind}\u0000${operatorId}`;

function registerAll(kind: StorageKind, translators: Readonly<Record<string, OperatorTranslator>>): void {
  for (const [op, fn] of Object.entries(translators)) table.set(keyOf(kind, op), fn);
}

registerAll("text", TEXT_TRANSLATORS);
registerAll("number", NUMBER_TRANSLATORS);
registerAll("boolean", BOOLEAN_TRANSLATORS);

/**
 * Plug in a translator for a (storage kind, operator id) pair — e.g. for custom
 * field types stored as kind "json". Later registrations win.
 */
export function registerOperatorTranslator(kind: StorageKind | string, operatorId: string, fn: OperatorTranslator): void {
  table.set(keyOf(kind, operatorId), fn);
}

export function getOperatorTranslator(kind: StorageKind | string, operatorId: string): OperatorTranslator | undefined {
  return table.get(keyOf(kind, operatorId));
}
