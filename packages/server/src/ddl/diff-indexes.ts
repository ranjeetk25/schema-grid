import type { ColumnDef, GridSchema } from "../internal/core";
import { type GeneratedColumnOptions, dropGeneratedColumnDDL, generatedColumnDDL } from "./generated-columns";
import type { DdlStatement } from "./tables-ddl";

function isEligible(column: ColumnDef): boolean {
  return column.indexed === true && !column.source;
}

/** True when the generated-column definition would differ (key aside). */
function definitionChanged(a: ColumnDef, b: ColumnDef): boolean {
  if (a.type !== b.type) return true;
  if (a.type === "formula") {
    if (a.formula !== b.formula) return true;
    const ar = (a.config as { resultType?: unknown } | null)?.resultType;
    const br = (b.config as { resultType?: unknown } | null)?.resultType;
    if (ar !== br) return true;
  }
  return false;
}

/**
 * Diffs the set of `indexed: true` (non-`source`) columns between two schema
 * versions and returns the `ALTER TABLE` statements to reconcile them: every
 * drop before every add. A key rename, or a type/formula/resultType change,
 * is a drop of the old generated column followed by an add of the new one.
 * `prev: null` means "nothing exists yet" (adds only).
 */
export function diffIndexedColumns(
  prev: GridSchema | null,
  next: GridSchema,
  table: string,
  options?: GeneratedColumnOptions,
): DdlStatement[] {
  const prevById = new Map<string, ColumnDef>((prev?.columns ?? []).map((c) => [c.id, c]));
  const nextById = new Map<string, ColumnDef>(next.columns.map((c) => [c.id, c]));
  const allIds = new Set<string>([...prevById.keys(), ...nextById.keys()]);

  const drops: DdlStatement[] = [];
  const adds: DdlStatement[] = [];

  for (const id of allIds) {
    const prevCol = prevById.get(id);
    const nextCol = nextById.get(id);
    const wasEligible = prevCol ? isEligible(prevCol) : false;
    const isNextEligible = nextCol ? isEligible(nextCol) : false;

    if (!wasEligible && !isNextEligible) continue;

    if (wasEligible && !isNextEligible) {
      drops.push(dropGeneratedColumnDDL(table, (prevCol as ColumnDef).key));
      continue;
    }

    if (!wasEligible && isNextEligible) {
      adds.push(generatedColumnDDL(table, nextCol as ColumnDef, options));
      continue;
    }

    const p = prevCol as ColumnDef;
    const n = nextCol as ColumnDef;
    if (p.key !== n.key || definitionChanged(p, n)) {
      drops.push(dropGeneratedColumnDDL(table, p.key));
      adds.push(generatedColumnDDL(table, n, options));
    }
  }

  return [...drops, ...adds];
}
