import { isFilterGroup, type FilterCondition, type FilterGroup, type FilterNode } from "../internal/core";

/** One filter condition per column id — the shape AG Grid's column filters (and our compound builder) read/write. */
export type ColumnFilterModel = Record<string, FilterCondition>;

export interface AstToFilterModelResult {
  model: ColumnFilterModel;
  /** Whatever couldn't be represented as one flat per-column condition: OR groups, nested groups, or repeat-column conditions. */
  residual: FilterNode | null;
  /** Column ids that have conditions living in `residual` (so the builder can flag them as "advanced" / already-edited). */
  advancedColumnIds: string[];
}

/**
 * Splits a `FilterNode` into a flat per-column `ColumnFilterModel` plus a
 * `residual` node for everything that model shape can't represent.
 *
 * A bare condition is treated as a 1-child AND. Top-level AND children that
 * are the *only* condition for their column become model entries; everything
 * else (a second condition on the same column, anything under a nested group,
 * and the whole tree when the root itself is an OR) goes to `residual`, and
 * those columns are listed in `advancedColumnIds`.
 */
export function astToFilterModel(ast: FilterNode | null): AstToFilterModelResult {
  if (!ast) return { model: {}, residual: null, advancedColumnIds: [] };

  // A bare condition is a flat AND of one.
  const topChildren: FilterNode[] = isFilterGroup(ast) && ast.op === "and" ? ast.children : isFilterGroup(ast) ? [] : [ast];

  if (isFilterGroup(ast) && ast.op === "or") {
    // The whole root is an OR: nothing can be pulled into a flat AND model.
    return { model: {}, residual: ast, advancedColumnIds: [] };
  }

  const countByColumn = new Map<string, number>();
  for (const child of topChildren) {
    if (!isFilterGroup(child)) {
      countByColumn.set(child.columnId, (countByColumn.get(child.columnId) ?? 0) + 1);
    }
  }

  const model: ColumnFilterModel = {};
  const residualChildren: FilterNode[] = [];
  const advancedColumnIds: string[] = [];

  for (const child of topChildren) {
    if (isFilterGroup(child)) {
      residualChildren.push(child);
      for (const id of columnIdsIn(child)) {
        if (!advancedColumnIds.includes(id)) advancedColumnIds.push(id);
      }
      continue;
    }
    if (countByColumn.get(child.columnId) === 1) {
      model[child.columnId] = child;
    } else {
      residualChildren.push(child);
      if (!advancedColumnIds.includes(child.columnId)) advancedColumnIds.push(child.columnId);
    }
  }

  const residual = buildResidual(residualChildren);
  return { model, residual, advancedColumnIds };
}

function columnIdsIn(node: FilterNode): string[] {
  const out: string[] = [];
  const visit = (n: FilterNode) => {
    if (isFilterGroup(n)) n.children.forEach(visit);
    else if (!out.includes(n.columnId)) out.push(n.columnId);
  };
  visit(node);
  return out;
}

function buildResidual(children: FilterNode[]): FilterNode | null {
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] as FilterNode;
  return { op: "and", children };
}

/**
 * Rebuilds a `FilterNode` from a `ColumnFilterModel` plus the `residual` node
 * `astToFilterModel` set aside. Model conditions come first, in insertion
 * order, followed by residual. An AND residual is flattened into the root
 * (never nested); an OR residual is kept as one nested child (depth 2 max).
 * Returns `null` when both are empty, a bare condition when there's exactly
 * one condition total and no residual group, and an AND group otherwise.
 */
export function filterModelToAst(model: ColumnFilterModel, residual: FilterNode | null): FilterNode | null {
  const modelConditions = Object.values(model);

  const children: FilterNode[] = [...modelConditions];
  if (residual) {
    if (isFilterGroup(residual) && residual.op === "and") {
      children.push(...residual.children);
    } else {
      children.push(residual);
    }
  }

  if (children.length === 0) return null;
  if (children.length === 1) return children[0] as FilterNode;
  return { op: "and", children };
}
