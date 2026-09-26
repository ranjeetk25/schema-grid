/**
 * Host ↔ workbench grid-event merge (v0.3). Framework-free (copied verbatim by ui-shadcn).
 *
 * `beforeCellsChange` CHAINS host → internal: the host may veto with `false`
 * or return a transformed / reduced batch (with `meta`), which is what the
 * internal hook (when any) and the grid then see. Every other event FANS OUT
 * to the host first, then the internal handler; a throwing host handler never
 * breaks the internal one (the error is handed to `onHostError`).
 *
 * v0.3.1: a re-submit (`batch.resubmitOf` set — a conflict "Overwrite") skips
 * the host's `beforeCellsChange` unless `confirmOnResubmit` is true: the host
 * already confirmed the original batch, whose `meta` the grid carries over.
 * The internal chain still runs.
 */
import type { SchemaGridEvents } from "@ranjeetk25/schema-grid-ag-grid";
import type { ChangeBatch } from "@ranjeetk25/schema-grid-core";

export type WorkbenchHostEvents = Partial<SchemaGridEvents>;

const FAN_OUT = [
  "onCellsChange",
  "onRowsCreate",
  "onRowsDelete",
  "onColumnCreate",
  "onColumnUpdate",
  "onColumnDelete",
  "onOptionCreate",
  "onViewChange",
  "onConflict",
  "onRemoteChanges",
  "onSchemaChanged",
] as const;

type FanOutName = (typeof FAN_OUT)[number];
type AnyHandler = (...args: never[]) => void;

/** `events` prop over `gridProps.events`: a handler on the prop wins, the rest of `gridProps.events` fills in. */
export function combineHostEvents(
  primary: WorkbenchHostEvents | undefined,
  fallback: WorkbenchHostEvents | undefined,
): WorkbenchHostEvents | undefined {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return { ...fallback, ...primary };
}

export interface MergeEventsOptions {
  /** Receives errors thrown by a host handler (the internal handler still runs). */
  onHostError?(error: unknown, event: keyof SchemaGridEvents): void;
  /** v0.3.1: also ask the host's `beforeCellsChange` for batches with `resubmitOf`. Default false. */
  confirmOnResubmit?: boolean;
}

export function mergeWorkbenchEvents(
  host: WorkbenchHostEvents | undefined,
  internal: SchemaGridEvents,
  options: MergeEventsOptions = {},
): SchemaGridEvents {
  if (!host) return internal;
  const out: SchemaGridEvents = { ...internal };
  const guard = <A extends unknown[]>(name: keyof SchemaGridEvents, fn: ((...args: A) => void) | undefined, args: A) => {
    if (!fn) return;
    try {
      fn(...args);
    } catch (error) {
      options.onHostError?.(error, name);
    }
  };

  for (const name of FAN_OUT) {
    const h = host[name] as AnyHandler | undefined;
    const i = internal[name] as AnyHandler | undefined;
    if (!h) continue;
    if (!i) {
      (out as Record<FanOutName, AnyHandler>)[name] = ((...args: never[]) => guard(name, h, args)) as AnyHandler;
      continue;
    }
    (out as Record<FanOutName, AnyHandler>)[name] = ((...args: never[]) => {
      guard(name, h, args);
      i(...args);
    }) as AnyHandler;
  }

  const hostBefore = host.beforeCellsChange;
  const internalBefore = internal.beforeCellsChange;
  if (hostBefore) {
    out.beforeCellsChange = async (batch: ChangeBatch) => {
      if (batch.resubmitOf !== undefined && options.confirmOnResubmit !== true) {
        return internalBefore ? internalBefore(batch) : batch;
      }
      const decided = await hostBefore(batch);
      if (decided === false) return false;
      const next = decided ?? batch;
      if (!internalBefore) return next;
      return internalBefore(next);
    };
  }
  return out;
}
