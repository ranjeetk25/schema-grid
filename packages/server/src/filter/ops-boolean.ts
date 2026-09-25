import { sql } from "drizzle-orm";
import type { OperatorTranslator } from "./types";

/** Both positive: an empty cell matches neither (core decision 3). */
export const BOOLEAN_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  isTrue: ({ expr }) => sql`${expr.typed} = 1`,
  isFalse: ({ expr }) => sql`${expr.typed} = 0`,
};
