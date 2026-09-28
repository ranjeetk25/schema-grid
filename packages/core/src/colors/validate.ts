import type { FieldTypeRegistry } from "../field-types/registry";
import { collectFilterErrors, type FilterValidationError } from "../filter/validate";
import type { FilterNode } from "../filter/types";
import { getColumnById } from "../schema/lookup";
import type { GridSchema } from "../schema/types";
import { type ColorRule, type ColorRuleTarget, isCellColor } from "./types";

/** A color rule problem: a filter validation error plus the offending rule's index. */
export interface ColorRuleIssue extends FilterValidationError {
  /** Index of the rule in the input list (absent when the list itself is malformed). */
  ruleIndex?: number;
  ruleId?: string;
}

export type ColorRulesValidation = { ok: true; rules: ColorRule[] } | { ok: false; issues: ColorRuleIssue[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Structural and access validation of a view's color rules (untrusted input):
 * palette colors, non-empty unique ids, `cells` targets with known readable
 * columns, `enabled` boolean when present, and `when` validated like a filter
 * (`collectFilterErrors`) except that color operators are rejected
 * (`colorInRule`) and `filterable: false` columns are accepted (v0.4.1; see
 * `colorFilterBlockers` for what that means for filtering by color). `path` of an issue points inside the rule's `when`
 * ([] for rule-level problems). Unreadable columns get a generic message, so
 * hidden labels never leak. `undefined` / `null` = no rules. On success the
 * rules are returned as clean copies (unknown keys dropped).
 */
export function validateColorRules(
  rules: unknown,
  schema: GridSchema,
  registry: FieldTypeRegistry,
  readableColumnIds: ReadonlySet<string>,
): ColorRulesValidation {
  if (rules === undefined || rules === null) return { ok: true, rules: [] };
  if (!Array.isArray(rules)) {
    return { ok: false, issues: [{ code: "invalidColorRule", path: [], message: "Color rules must be a list" }] };
  }
  const issues: ColorRuleIssue[] = [];
  const out: ColorRule[] = [];
  const seen = new Set<string>();
  rules.forEach((raw: unknown, ruleIndex) => {
    const bad = (message: string) => {
      const issue: ColorRuleIssue = { code: "invalidColorRule", path: [], message, ruleIndex };
      if (isObject(raw) && typeof raw.id === "string" && raw.id !== "") issue.ruleId = raw.id;
      issues.push(issue);
    };
    if (!isObject(raw)) return bad("Malformed color rule");
    const { id, color, target, when, enabled } = raw;
    if (typeof id !== "string" || id === "") return bad("A color rule needs an id");
    if (seen.has(id)) return bad(`Duplicate color rule id "${id}"`);
    seen.add(id);
    if (!isCellColor(color)) return bad("Unknown color");
    if (enabled !== undefined && typeof enabled !== "boolean") return bad("`enabled` must be true or false");
    if (!isObject(target) || (target.kind !== "row" && target.kind !== "cells")) return bad("Unknown rule target");
    let cleanTarget: ColorRuleTarget = { kind: "row" };
    if (target.kind === "cells") {
      const ids = target.columnIds;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((c) => typeof c === "string")) {
        return bad("A cells rule needs at least one column");
      }
      let targetOk = true;
      for (const columnId of ids as string[]) {
        const column = getColumnById(schema, columnId);
        if (!column) {
          issues.push({ code: "unknownColumn", path: [], columnId, message: "Unknown column", ruleIndex, ruleId: id });
          targetOk = false;
        } else if (!readableColumnIds.has(column.id)) {
          // Deliberately generic: never leak a hidden column's label.
          issues.push({
            code: "unreadableColumn",
            path: [],
            columnId,
            message: "You do not have access to this column",
            ruleIndex,
            ruleId: id,
          });
          targetOk = false;
        }
      }
      if (!targetOk) return;
      cleanTarget = { kind: "cells", columnIds: [...(ids as string[])] };
    }
    if (when !== null && when !== undefined && !isObject(when)) return bad("Malformed rule condition");
    const node = (when ?? null) as FilterNode | null;
    // `filterable: false` columns are allowed: the rule renders from row values (v0.4.1).
    const whenErrors = collectFilterErrors(node, schema, registry, readableColumnIds, false, false);
    if (whenErrors.length > 0) {
      for (const e of whenErrors) issues.push({ ...e, ruleIndex, ruleId: id });
      return;
    }
    const rule: ColorRule = {
      id,
      color,
      target: cleanTarget,
      when: node === null ? null : (structuredClone(node) as FilterNode),
    };
    if (enabled !== undefined) rule.enabled = enabled;
    out.push(rule);
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, rules: out };
}

