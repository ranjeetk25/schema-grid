import { createServerContext } from "../context";
import { planFormulaColumns } from "../formula/formula-plan";
import {
  type ColumnDef,
  type FieldTypeRegistry,
  type FilterNode,
  type GridSchema,
  createRolePermissionResolver,
  dependencies,
  detectFormulaCycles,
  getColumnFieldType,
  isFormulaError,
  parseFormula,
  validateFilter,
} from "../internal/core";
import type { FormulaPlan } from "../sql/scope";
import { storageKindOf } from "../sql/storage-kind";
import { isSafeColumnKey } from "../storage/keys";
import { defineGridTables } from "../storage/tables";
import { type SchemaIssue, SchemaValidationError } from "../errors";

export interface SchemaValidationResult {
  ok: boolean;
  issues: SchemaIssue[];
}

export interface ValidateSchemaOptions {
  /** Physical column names on the rows table (targets for `source.valueField`). */
  physicalColumns?: string[];
}

/** Builds a throwaway scope so we can ask `planFormulaColumns` whether an indexed formula is SQL-translatable. */
function computeFormulaPlans(schema: GridSchema, registry: FieldTypeRegistry): Map<string, FormulaPlan> | null {
  try {
    const ctx = createServerContext({
      schema,
      registry,
      resolver: createRolePermissionResolver(),
      user: { id: "__validate_schema__", roles: ["admin"] },
    });
    const tables = defineGridTables({ rowsTable: "validate_rows", changeLogTable: "validate_log" });
    return planFormulaColumns({ ctx, tables, generatedColumns: "ignore" });
  } catch {
    return null;
  }
}

/**
 * Validates a `GridSchema` against the field type registry: uniqueness and
 * safety of ids/keys, config/default value shapes, formula parsing/cycles/
 * refs, index eligibility, and view filter/sort/groupBy column references.
 * Collects every issue found rather than stopping at the first.
 */
export function validateSchema(
  schema: GridSchema,
  registry: FieldTypeRegistry,
  options: ValidateSchemaOptions = {},
): SchemaValidationResult {
  const issues: SchemaIssue[] = [];

  if (!Number.isInteger(schema.schemaVersion) || schema.schemaVersion < 0) {
    issues.push({
      code: "invalidSchemaVersion",
      path: ["schemaVersion"],
      message: `schemaVersion must be a non-negative integer, got ${JSON.stringify(schema.schemaVersion)}`,
    });
  }

  const seenIds = new Map<string, number>();
  const seenKeys = new Map<string, number>();
  const valueFieldOwners = new Map<string, number[]>();
  let formulaPlans: Map<string, FormulaPlan> | null | undefined;
  const getFormulaPlans = (): Map<string, FormulaPlan> | null => {
    if (formulaPlans === undefined) formulaPlans = computeFormulaPlans(schema, registry);
    return formulaPlans;
  };

  schema.columns.forEach((column: ColumnDef, i: number) => {
    const path = (...rest: (string | number)[]): (string | number)[] => ["columns", i, ...rest];

    if (seenIds.has(column.id)) {
      issues.push({ code: "duplicateId", columnId: column.id, path: path("id"), message: `Duplicate column id "${column.id}"` });
    } else {
      seenIds.set(column.id, i);
    }

    if (seenKeys.has(column.key)) {
      issues.push({ code: "duplicateKey", columnId: column.id, path: path("key"), message: `Duplicate column key "${column.key}"` });
    } else {
      seenKeys.set(column.key, i);
    }

    if (!isSafeColumnKey(column.key)) {
      issues.push({
        code: "unsafeKey",
        columnId: column.id,
        path: path("key"),
        message: `Column key "${column.key}" is not a safe identifier`,
      });
    }

    const fieldType = registry.get(column.type as string);
    if (!fieldType) {
      issues.push({
        code: "unknownType",
        columnId: column.id,
        path: path("type"),
        message: `Unknown field type "${column.type}"`,
      });
    } else {
      const configResult = fieldType.configSchema.safeParse(column.config);
      if (!configResult.success) {
        issues.push({
          code: "invalidConfig",
          columnId: column.id,
          path: path("config"),
          message: configResult.error.issues[0]?.message ?? "Invalid config",
        });
      }
    }

    if (column.type === "formula") {
      if (column.source) {
        issues.push({
          code: "invalidSource",
          columnId: column.id,
          path: path("source"),
          message: `Formula column "${column.id}" may not declare a source`,
        });
      }
      if (column.formula === undefined) {
        issues.push({
          code: "missingFormula",
          columnId: column.id,
          path: path("formula"),
          message: `Formula column "${column.id}" is missing a formula`,
        });
      } else {
        const ast = parseFormula(column.formula);
        if (isFormulaError(ast)) {
          issues.push({
            code: "formulaSyntax",
            columnId: column.id,
            path: path("formula"),
            message: ast.message,
          });
        } else {
          const keys = new Set(schema.columns.map((c) => c.key));
          for (const ref of dependencies(ast)) {
            if (!keys.has(ref)) {
              issues.push({
                code: "formulaUnknownRef",
                columnId: column.id,
                path: path("formula"),
                message: `Formula references unknown column "${ref}"`,
              });
            }
          }
        }
      }
    } else if (column.formula !== undefined) {
      issues.push({
        code: "unexpectedFormula",
        columnId: column.id,
        path: path("formula"),
        message: `Column "${column.id}" (${column.type}) may not declare a formula`,
      });
    }

    if (column.source) {
      const valueField = column.source.valueField;
      if (!options.physicalColumns) {
        issues.push({
          code: "unknownValueField",
          columnId: column.id,
          path: path("source", "valueField"),
          message: `Column "${column.id}" source.valueField "${valueField}" is not declared as a physical column`,
        });
      } else if (!options.physicalColumns.includes(valueField)) {
        issues.push({
          code: "unknownValueField",
          columnId: column.id,
          path: path("source", "valueField"),
          message: `Column "${column.id}" source.valueField "${valueField}" is not among the declared physical columns`,
        });
      }
      const owners = valueFieldOwners.get(valueField) ?? [];
      owners.push(i);
      valueFieldOwners.set(valueField, owners);
    }

    if (column.indexed) {
      let reason: string | null = null;
      if (column.source) reason = "physical-source columns are indexed by the consumer";
      else if (column.type === "longText") reason = "longText columns are not indexable";
      else {
        const kind = storageKindOf(column, registry).kind;
        if (kind === "multi") reason = "multi-valued columns are not indexable";
        else if (kind === "json") reason = "unknown/custom-typed columns are not indexable";
      }
      if (reason) {
        issues.push({
          code: "notIndexable",
          columnId: column.id,
          path: path("indexed"),
          message: `Column "${column.id}" (${column.type}) cannot be indexed: ${reason}`,
        });
      } else if (column.type === "formula" && column.formula) {
        const plans = getFormulaPlans();
        const plan = plans?.get(column.id);
        if (!plan || plan.mode === "fallback") {
          issues.push({
            code: "formulaNotTranslatable",
            columnId: column.id,
            path: path("formula"),
            message: `Formula column "${column.id}" is not SQL-translatable and cannot be indexed`,
          });
        }
      }
    }

    if (column.defaultValue !== undefined && fieldType) {
      const valueFieldType = getColumnFieldType(column, registry) ?? fieldType;
      const result = valueFieldType.valueSchema(column.config).safeParse(column.defaultValue);
      if (!result.success) {
        issues.push({
          code: "invalidDefault",
          columnId: column.id,
          path: path("defaultValue"),
          message: result.error.issues[0]?.message ?? "Invalid default value",
        });
      }
    }
  });

  for (const [valueField, owners] of valueFieldOwners) {
    if (owners.length < 2) continue;
    for (const idx of owners.slice(1)) {
      const column = schema.columns[idx] as ColumnDef;
      issues.push({
        code: "duplicateValueField",
        columnId: column.id,
        path: ["columns", idx, "source", "valueField"],
        message: `Column "${column.id}" shares source.valueField "${valueField}" with another column`,
      });
    }
  }

  const cycles = detectFormulaCycles(schema);
  if (cycles.length > 0) {
    const byKey = new Map(schema.columns.map((c, i) => [c.key, { column: c, index: i }]));
    for (const cycle of cycles) {
      for (const key of cycle) {
        const entry = byKey.get(key);
        if (!entry) continue;
        issues.push({
          code: "formulaCycle",
          columnId: entry.column.id,
          path: ["columns", entry.index, "formula"],
          message: `Formula column "${entry.column.id}" is part of a cycle: ${cycle.join(" -> ")}`,
        });
      }
    }
  }

  const columnIds = new Set(schema.columns.map((c) => c.id));
  const allReadable = columnIds;

  (schema.views ?? []).forEach((view, vi) => {
    const checkFilterRefs = (node: FilterNode, path: (string | number)[]) => {
      if ("op" in node) {
        node.children.forEach((child, i) => checkFilterRefs(child, [...path, "children", i]));
        return;
      }
      if (!columnIds.has(node.columnId)) {
        issues.push({
          code: "viewUnknownColumn",
          columnId: node.columnId,
          path,
          message: `View "${view.id}" filter references unknown column "${node.columnId}"`,
        });
      }
    };

    if (view.filter) checkFilterRefs(view.filter, ["views", vi, "filter"]);

    view.sort.forEach((s, si) => {
      if (!columnIds.has(s.columnId)) {
        issues.push({
          code: "viewUnknownColumn",
          columnId: s.columnId,
          path: ["views", vi, "sort", si, "columnId"],
          message: `View "${view.id}" sort references unknown column "${s.columnId}"`,
        });
      }
    });

    view.groupBy.forEach((g, gi) => {
      if (!columnIds.has(g.columnId)) {
        issues.push({
          code: "viewUnknownColumn",
          columnId: g.columnId,
          path: ["views", vi, "groupBy", gi, "columnId"],
          message: `View "${view.id}" groupBy references unknown column "${g.columnId}"`,
        });
      }
      (g.aggregations ?? []).forEach((agg, ai) => {
        if (!columnIds.has(agg.columnId)) {
          issues.push({
            code: "viewUnknownColumn",
            columnId: agg.columnId,
            path: ["views", vi, "groupBy", gi, "aggregations", ai, "columnId"],
            message: `View "${view.id}" groupBy aggregation references unknown column "${agg.columnId}"`,
          });
        }
      });
    });

    if (view.filter) {
      const errors = validateFilter(view.filter, schema, registry, allReadable);
      for (const error of errors) {
        issues.push({
          code: "viewInvalidFilter",
          ...(error.columnId ? { columnId: error.columnId } : {}),
          path: ["views", vi, "filter", ...error.path],
          message: error.message,
        });
      }
    }
  });

  return { ok: issues.length === 0, issues };
}

/** Throws `SchemaValidationError` with every issue when `validateSchema` fails. */
export function assertValidSchema(schema: GridSchema, registry: FieldTypeRegistry, options: ValidateSchemaOptions = {}): void {
  const result = validateSchema(schema, registry, options);
  if (!result.ok) throw new SchemaValidationError(result.issues);
}
