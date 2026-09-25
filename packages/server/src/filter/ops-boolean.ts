import { sql } from "drizzle-orm";
import type { OperatorTranslator } from "./types";

/**
 * Both positive: an empty cell matches neither (core decision 3). `isEmpty` /
 * `isNotEmpty` need no entry: `translateFilter` handles them for every kind via
 * `expr.empty` (for booleans: the typed CASE is NULL — `false` is not empty).
 */
export const BOOLEAN_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  isTrue: ({ expr }) => sql`${expr.typed} = 1`,
  isFalse: ({ expr }) => sql`${expr.typed} = 0`,
};
