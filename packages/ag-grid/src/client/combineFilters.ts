import { type FilterCondition, type FilterGroup, type FilterNode, isFilterGroup } from "../internal/core";

function isDeepGroup(node: FilterNode): node is FilterGroup {
  return isFilterGroup(node) && node.children.some(isFilterGroup);
}

function isEmptyGroup(node: FilterNode): boolean {
  return isFilterGroup(node) && node.children.length === 0;
}

/**
 * AND-combine several filters (external filter, view filter, group pinning…).
 *
 * - null/undefined and empty groups are ignored; nothing left → `null`.
 * - A single remaining node is returned unchanged (same reference).
 * - AND groups are flattened into the result; OR groups and conditions become
 *   one child each.
 * - Depth: with valid inputs (depth ≤ 2) the result is depth ≤ 2, except when a
 *   "deep" OR (an OR containing groups) must be AND-ed with other things. If all
 *   the other children are plain conditions, the AND is distributed into the OR
 *   (`c ∧ (g1 ∨ g2)` → `(c ∧ g1) ∨ (c ∧ g2)`), which stays at depth 2. Any other
 *   mix (two deep ORs, or a deep OR next to another group) falls back to plain
 *   nesting (depth 3); callers validating the result will see `depthExceeded`.
 */
export function combineFilters(...nodes: (FilterNode | null | undefined)[]): FilterNode | null {
  const present = nodes.filter((n): n is FilterNode => !!n && !isEmptyGroup(n));
  if (present.length === 0) return null;
  if (present.length === 1) return present[0] ?? null;

  const children: FilterNode[] = [];
  for (const node of present) {
    if (isFilterGroup(node) && node.op === "and") children.push(...node.children.filter((c) => !isEmptyGroup(c)));
    else children.push(node);
  }
  if (children.length === 1) return children[0] ?? null;

  const deep = children.filter(isDeepGroup);
  const first = deep[0];
  if (deep.length === 1 && first && first.op === "or") {
    const others = children.filter((c) => c !== first);
    if (others.every((c) => !isFilterGroup(c))) {
      const conditions = others as FilterCondition[];
      return {
        op: "or",
        children: first.children.map((branch): FilterNode => {
          const branchChildren = isFilterGroup(branch) && branch.op === "and" ? branch.children : [branch];
          return { op: "and", children: [...conditions, ...branchChildren] };
        }),
      };
    }
  }
  return { op: "and", children };
}
