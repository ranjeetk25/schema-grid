import type { ZodType } from "zod";
import type { AggregationId } from "../query/types";
import type { FilterOperatorDef } from "../filter/operators";
import type { FieldTypeId } from "./ids";

/**
 * Result of parsing free-form input (clipboard/import text) into a typed value.
 * Never thrown: callers surface `error` to the user instead.
 */
export type ParseResult<T> =
  | { ok: true; value: T; pendingOptions?: string[]; warnings?: string[] }
  | { ok: false; error: string };

/**
 * Contract implemented by every field type (built-in or custom).
 *
 * Implementations MUST tolerate partial/missing config at runtime: config
 * coming from persisted JSON schema may be incomplete or stale (e.g. a field
 * added to `configSchema` after existing columns were created), so every
 * method that receives `config` should treat it as a partial overlay on top
 * of `defaultConfig` (typically by merging `{ ...defaultConfig, ...config }`
 * before use) rather than assuming all keys are present.
 */
export interface FieldType<TValue = unknown, TConfig = unknown> {
  id: FieldTypeId;
  label: string;
  configSchema: ZodType<TConfig>;
  defaultConfig: TConfig;
  valueSchema(config: TConfig): ZodType<TValue | null>;
  parse(input: unknown, config: TConfig): ParseResult<TValue | null>;
  format(value: TValue | null | undefined, config: TConfig): string;
  serialize(value: TValue | null): unknown;
  deserialize(raw: unknown): TValue | null;
  compare(a: TValue | null, b: TValue | null, config: TConfig): number;
  operators: readonly FilterOperatorDef[];
  fillSeries?(values: (TValue | null)[], count: number, config: TConfig): TValue[];
  aggregations?: readonly AggregationId[];
  defaultValue(config: TConfig): TValue | null;
}

/**
 * Type-erased view of `FieldType<TValue, TConfig>` used everywhere a
 * heterogeneous collection of field types is needed (the registry, column
 * lookups, etc). Deliberately avoids `any`: every member uses method syntax
 * (not property function types) so parameters are checked bivariantly,
 * which lets any concrete `FieldType<TValue, TConfig>` be assigned here
 * without unsafe casts.
 */
export interface AnyFieldType {
  id: FieldTypeId;
  label: string;
  configSchema: ZodType<unknown>;
  defaultConfig: unknown;
  valueSchema(config: unknown): ZodType<unknown>;
  parse(input: unknown, config: unknown): ParseResult<unknown>;
  format(value: unknown, config: unknown): string;
  serialize(value: unknown): unknown;
  deserialize(raw: unknown): unknown;
  compare(a: unknown, b: unknown, config: unknown): number;
  operators: readonly FilterOperatorDef[];
  fillSeries?(values: unknown[], count: number, config: unknown): unknown[];
  aggregations?: readonly AggregationId[];
  defaultValue(config: unknown): unknown;
}
