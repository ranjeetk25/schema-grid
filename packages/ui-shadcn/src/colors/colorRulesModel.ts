/**
 * Pure draft model for the color rules editor (v0.4). No React, no DOM.
 * Rules are edited as a plain ordered `ColorRule[]` (first match wins within
 * its tier), validated with core's `validateColorRules` before saving.
 */
import {
  CELL_COLORS,
  type ColorRule,
  type ColorRuleIssue,
  type ColorRulesValidation,
  type FieldTypeRegistry,
  type GridSchema,
  validateColorRules,
} from "../internal/core-contracts";

let seq = 0;

/** A rule id unique in `rules` (and across calls). */
export function newColorRuleId(rules: readonly ColorRule[]): string {
  const taken = new Set(rules.map((r) => r.id));
  let id: string;
  do {
    id = `rule_${Date.now().toString(36)}_${(++seq).toString(36)}`;
  } while (taken.has(id));
  return id;
}

/** Appends an enabled whole-row rule with no condition, colored with the first palette color not in use. */
export function addColorRule(rules: readonly ColorRule[]): ColorRule[] {
  const used = new Set(rules.map((r) => r.color));
  const color = CELL_COLORS.find((c) => !used.has(c)) ?? CELL_COLORS[0] ?? "red";
  return [...rules, { id: newColorRuleId(rules), color, target: { kind: "row" }, when: null, enabled: true }];
}

/** Moves the rule at `index` by `delta` (-1 up, +1 down); out of bounds returns `rules` itself. */
export function moveColorRule<T extends readonly ColorRule[]>(rules: T, index: number, delta: -1 | 1): T | ColorRule[] {
  const to = index + delta;
  if (index < 0 || index >= rules.length || to < 0 || to >= rules.length) return rules;
  const next = [...rules];
  const [moved] = next.splice(index, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

export function updateColorRule(rules: readonly ColorRule[], index: number, patch: Partial<Omit<ColorRule, "id">>): ColorRule[] {
  return rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
}

export function removeColorRule(rules: readonly ColorRule[], index: number): ColorRule[] {
  return rules.filter((_, i) => i !== index);
}

/** Core `validateColorRules` over the draft (readable columns only, color operators rejected in `when`). */
export function validateColorRulesDraft(
  rules: readonly ColorRule[],
  schema: GridSchema,
  registry: FieldTypeRegistry,
  readable: ReadonlySet<string>,
): ColorRulesValidation {
  return validateColorRules(rules, schema, registry, readable);
}

/** Issue messages per rule index (deduplicated, in order). Issues without an index are keyed `-1`. */
export function ruleIssueMessages(issues: readonly ColorRuleIssue[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const issue of issues) {
    const key = issue.ruleIndex ?? -1;
    const list = out.get(key) ?? [];
    if (!list.includes(issue.message)) list.push(issue.message);
    out.set(key, list);
  }
  return out;
}
