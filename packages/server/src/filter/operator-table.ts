import type { StorageKind } from "../sql/storage-kind";
import { BOOLEAN_TRANSLATORS } from "./ops-boolean";
import { CHOICE_TRANSLATORS, REF_TRANSLATORS } from "./ops-choice";
import { DATE_TRANSLATORS, DATETIME_TRANSLATORS } from "./ops-date";
import { MULTI_TRANSLATORS } from "./ops-multi";
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
registerAll("choice", CHOICE_TRANSLATORS);
registerAll("ref", REF_TRANSLATORS);
registerAll("multi", MULTI_TRANSLATORS);
registerAll("date", DATE_TRANSLATORS);
registerAll("datetime", DATETIME_TRANSLATORS);

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
