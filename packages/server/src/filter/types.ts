import type { SQL } from "drizzle-orm";
import type { ColumnDef, FilterOperatorDef, FilterValue } from "../internal/core";
import type { ColumnExpr } from "../sql/column-expr";
import type { SqlScope } from "../sql/scope";

export interface OperatorTranslatorArgs {
  expr: ColumnExpr;
  column: ColumnDef;
  operator: FilterOperatorDef;
  value: FilterValue | undefined;
  scope: SqlScope;
}

/**
 * Returns ONLY the comparison. `translateFilter` applies the null rule around it:
 * negative operators become `(<cmp> OR <empty>)`, positive ones `(<cmp> AND NOT <empty>)`.
 */
export type OperatorTranslator = (args: OperatorTranslatorArgs) => SQL;
