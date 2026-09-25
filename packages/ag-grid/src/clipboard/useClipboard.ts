/**
 * Clipboard wiring (T24): copy and paste for the grid, over the pure
 * `buildCopyMatrix` / `planPaste` planners.
 *
 * Browser delivery
 * - The `.sg-root` element (attached through `rootRef`) gets native
 *   `beforecopy` / `beforepaste` listeners that `preventDefault()`: in
 *   Chromium/WebKit that enables the copy/paste commands on non-editable
 *   content (a focused grid cell), so the native events fire.
 * - The preferred path is the SYNCHRONOUS native `copy` / `paste` event with
 *   `clipboardData` (permission-free). `onCopy` / `onPaste` are the root's
 *   listeners (`<SchemaGrid>` wires them), which also serve menu copy/paste.
 * - Ctrl/Cmd+C and Ctrl/Cmd+V (root keydown via `keyboard.registerRoot`)
 *   return `"handled-no-prevent"`, so the browser default (the native event)
 *   still runs. Because a clipboard event on non-editable content targets the
 *   selection or `<body>` rather than the focused cell, the keydown also arms
 *   a one-shot CAPTURE listener on `document` that takes the event while
 *   `document.activeElement` is inside the root and not editable
 *   (`stopPropagation`). The keydown also arms a `setTimeout(0)` fallback that
 *   removes that listener and, only if no event arrived, uses the async API:
 *   `navigator.clipboard.writeText` (rejection / absence → "Copy failed") or
 *   `navigator.clipboard.readText` (rejection → "Paste failed"). Any clipboard
 *   event reaching our listeners cancels the pending fallback, so exactly one
 *   path acts per keystroke. Auto-repeat keydowns are ignored.
 *   `document.execCommand` is never used.
 * - A copy event only overrides the browser when the selection is collapsed or
 *   lies inside an `.ag-cell` (so selecting header/banner text still copies
 *   that text). A paste event is only taken when its `clipboardData.types`
 *   include "text/plain" (image-only clipboards are left alone).
 *
 * Nothing happens while a cell editor is open (`isGridEditing`) or when the
 * event target is an editable element (`isEditableTarget`): editors keep
 * native text copy/paste.
 *
 * Copy: the TSV of the current range, or of the focused cell when there is no
 * range. Hidden columns are never displayed, so never copied. Formula cells
 * copy their result; a formula ERROR copies as blank (`getCellValue` maps
 * errors to null). No data rows in range → nothing is written.
 *
 * Paste
 * 1. Empty or newline-only text → "Nothing to paste", no change.
 * 2. `parseTsv` → `planPaste` against the displayed schema columns; rows come
 *    from `api.getDisplayedRowAtIndex(i)?.data` (group / load-more / unloaded
 *    rows are skipped without consuming a source row). No-op cells are dropped.
 * 3. Pending creatable options: every distinct (column, label) is created
 *    CONCURRENTLY through `dataSource.createOption` (`Promise.allSettled`);
 *    `events.onOptionCreate` fires for each created option (errors thrown by
 *    it are logged, never abort the paste) and the label placeholder in `next`
 *    is swapped for the new id. A cell whose option couldn't be created (no
 *    `createOption`, or it rejected) is dropped and reported as an error.
 *    The grid's `schema` prop is NOT updated with created options: the
 *    consumer should add them in `onOptionCreate` (otherwise a later paste of
 *    the same label, e.g. across views, will create it again unless the data
 *    source dedupes by label as core's in-memory source does).
 * 4. ONE `controller.submit(changes, "paste")` (skipped when empty).
 * 5. `ClipboardReport { pastedCells, skippedReadOnly, conflicts, errors }`:
 *    `pastedCells` = cells the data source applied (0 when vetoed);
 *    `conflicts` = cells it reported as conflicts; `skippedReadOnly` = cells
 *    the plan skipped as read-only + cells the controller rejected as
 *    read-only at submit time (`outcome.readOnly`, v0.2 C3); `errors` = parse
 *    errors + option errors + the data source's per-cell errors (never the
 *    controller's read-only rejections). Planning errors are
 *    set on the cell status store in one `setErrors` call (the controller
 *    marks the data source's). Handed to `onClipboardReport` and announced:
 *    "Paste: N pasted, M skipped, K errors" (+ ", C conflicts" when C > 0).
 *    An unexpected failure logs `console.error` and announces "Paste failed".
 *    After unmount, pending async work stops at the next await.
 */
import type { GridApi } from "ag-grid-community";
import { type RefObject, useEffect, useState } from "react";
import { type Politeness, pasteSummaryMessage } from "../a11y/announcer";
import type { EditController, SubmitOutcome } from "../editing/editController";
import {
  isEditableTarget,
  isGridEditing,
  type KeyboardRegistry,
  matchesShortcut,
  type RootKeyHandler,
} from "../grid/keyboard";
import type { DisplayRow } from "../grouping/clientGroups";
import type {
  Access,
  CellChange,
  ColumnDef,
  DataSource,
  FieldTypeRegistry,
  GridRow,
  GridSchema,
  Option,
  SchemaGridEvents,
} from "../internal/core";
import type { CellPos, NormalizedRange } from "../range/geometry";
import { displayedColIds, normalizedRangeFor } from "../range/useRangeSelection";
import type { CellStatusStore } from "../state/cellStatusStore";
import type { RangeStore } from "../state/rangeStore";
import { buildCopyMatrix } from "./copyPlan";
import { type PastePendingOptions, planPaste } from "./pastePlan";
import { parseTsv, serializeTsv } from "./tsv";
import type { ClipboardReport } from "./types";

export type { ClipboardReport } from "./types";

export interface UseClipboardOptions<Row extends GridRow = GridRow> {
  apiRef: RefObject<GridApi<Row> | null>;
  rangeStore: RangeStore;
  controller: EditController<Row>;
  /** The Ctrl/Cmd+C / Ctrl/Cmd+V root handler is registered on it for the hook's lifetime. */
  keyboard: KeyboardRegistry<Row>;
  cellStatus: CellStatusStore;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access: Map<string, Access>;
  canEditCell(row: Row, columnId: string): boolean;
  /** Computed values (formula results) for copy. */
  getCellValue?(row: Row, column: ColumnDef): unknown;
  dataSource: Pick<DataSource<Row>, "createOption">;
  /** Latest events getter (for `onOptionCreate`). */
  events?(): SchemaGridEvents<Row> | undefined;
  onClipboardReport?(report: ClipboardReport): void;
  announce?(message: string, politeness?: Politeness): void;
}

/** The parts of a native or React ClipboardEvent the handlers use. */
export interface ClipboardEventLike {
  clipboardData: (Pick<DataTransfer, "getData" | "setData"> & { types?: ArrayLike<string> }) | null;
  target: EventTarget | null;
  preventDefault(): void;
}

/** Stable for the hook's lifetime. */
export interface ClipboardHandlers {
  /** `.sg-root` `copy` listener. */
  onCopy(event: ClipboardEventLike): void;
  /** `.sg-root` `paste` listener. */
  onPaste(event: ClipboardEventLike): void;
  /** Ctrl/Cmd+C / Ctrl/Cmd+V handler (already registered on `keyboard`). */
  onRootKeyDown: RootKeyHandler;
  /** Callback ref for the `.sg-root` element (installs `beforecopy` / `beforepaste`). */
  rootRef(element: HTMLElement | null): void;
  /** TSV of the current range (or focused cell); null when there is nothing to copy. */
  copyText(): string | null;
  /** Pastes `text` at the current range/focused cell; null when nothing was pasted (no target, empty text, failure). */
  paste(text: string): Promise<ClipboardReport | null>;
}

/** T30 standard wording; the builder lives in `a11y/announcer` (re-exported here). */
export { pasteSummaryMessage };

/**
 * The report numbers one paste submit contributes: applied / conflict counts
 * (0 when vetoed), controller read-only rejections (`outcome.readOnly`) as
 * `skippedReadOnly`, and every other per-cell error.
 */
export function pasteOutcomeCounts(
  outcome: SubmitOutcome,
): Pick<ClipboardReport, "pastedCells" | "conflicts" | "skippedReadOnly" | "errors"> {
  const readOnly = new Set((outcome.readOnly ?? []).map((c) => pairKey(c.rowId, c.columnId)));
  const errors: ClipboardReport["errors"] = [];
  let rejected = 0;
  for (const e of outcome.result.errors) {
    if (readOnly.has(pairKey(e.rowId, e.columnId))) {
      rejected += 1;
      continue;
    }
    if (!outcome.vetoed) errors.push({ rowId: e.rowId, columnId: e.columnId, message: e.message });
  }
  return {
    pastedCells: outcome.vetoed ? 0 : outcome.result.applied.length,
    conflicts: outcome.vetoed ? 0 : outcome.result.conflicts.length,
    skippedReadOnly: rejected,
    errors,
  };
}

export const NOTHING_TO_PASTE = "Nothing to paste";
export const PASTE_FAILED = "Paste failed";
export const COPY_FAILED = "Copy failed";

type ClipboardLike = Partial<Pick<Clipboard, "readText" | "writeText">>;
type Kind = "copy" | "paste";

function systemClipboard(): ClipboardLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as { clipboard?: ClipboardLike }).clipboard ?? undefined;
}

const COPY = { key: "c", mod: true } as const;
const PASTE = { key: "v", mod: true } as const;

function pairKey(a: string, b: string): string {
  return `${a}\u0000${b}`;
}

function swapLabels(value: unknown, labels: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return labels.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? (labels.get(v) ?? v) : v));
  return value;
}

function isEmptyPaste(text: string): boolean {
  return /^[\r\n]*$/.test(text);
}

function hasPlainText(data: { types?: ArrayLike<string> }): boolean {
  return Array.from(data.types ?? []).includes("text/plain");
}

/** Collapsed / no selection, or a selection inside a grid cell: the grid owns the copy. */
function selectionAllowsOverride(): boolean {
  const selection = typeof document !== "undefined" ? document.getSelection?.() : null;
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return true;
  const node = selection.anchorNode;
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return !!el?.closest(".ag-cell");
}

interface Internal extends ClipboardHandlers {
  setActive(active: boolean): void;
}

export function useClipboard<Row extends GridRow = GridRow>(options: UseClipboardOptions<Row>): ClipboardHandlers {
  const [latest] = useState(() => ({ current: options }));
  latest.current = options;

  const [handlers] = useState<Internal>(() => {
    let active = true;
    let root: HTMLElement | null = null;
    /** The keystroke waiting for its native clipboard event (or the async fallback). */
    let pending: { kind: Kind; timer: ReturnType<typeof setTimeout>; listener: (e: Event) => void } | null = null;

    const announce = (message: string, politeness: Politeness = "polite"): void => {
      if (active) latest.current.announce?.(message, politeness);
    };

    const cancelPending = (): void => {
      if (!pending) return;
      clearTimeout(pending.timer);
      document.removeEventListener(pending.kind, pending.listener, true);
      pending = null;
    };

    const api = (): GridApi<Row> | null => latest.current.apiRef.current;
    const blocked = (target: EventTarget | null): boolean => isEditableTarget(target) || isGridEditing(api());

    const getRowAt =
      (gridApi: GridApi<Row>) =>
      (rowIndex: number): DisplayRow<Row> | undefined =>
        gridApi.getDisplayedRowAtIndex(rowIndex)?.data as DisplayRow<Row> | undefined;

    /** The current range (normalized), else the focused cell; null when neither. */
    const currentTarget = (gridApi: GridApi<Row>): { anchor: CellPos; selection: NormalizedRange | null } | null => {
      const range = normalizedRangeFor(gridApi, latest.current.rangeStore.get());
      const first = range?.colIds[0];
      if (range && first !== undefined) {
        return { anchor: { rowIndex: range.rowStart, colId: first }, selection: range };
      }
      const focused = gridApi.getFocusedCell();
      if (!focused || focused.rowPinned || focused.rowIndex < 0) return null;
      return { anchor: { rowIndex: focused.rowIndex, colId: focused.column.getColId() }, selection: null };
    };

    const hasTarget = (): boolean => {
      const gridApi = api();
      return !!gridApi && currentTarget(gridApi) !== null;
    };

    const copyText = (): string | null => {
      const gridApi = api();
      if (!gridApi) return null;
      const target = currentTarget(gridApi);
      if (!target) return null;
      const range: NormalizedRange = target.selection ?? {
        rowStart: target.anchor.rowIndex,
        rowEnd: target.anchor.rowIndex,
        colIds: [target.anchor.colId],
      };
      const o = latest.current;
      const columnsById = new Map(o.schema.columns.map((c) => [c.id, c]));
      const matrix = buildCopyMatrix<Row>(range, getRowAt(gridApi), columnsById, o.registry, o.access, {
        ...(o.getCellValue ? { getCellValue: o.getCellValue } : {}),
      });
      if (matrix.length === 0 || matrix.every((line) => line.length === 0)) return null;
      return serializeTsv(matrix);
    };

    /**
     * Creates every distinct pending option concurrently and swaps the new ids
     * into `changes`. Cells whose options failed are dropped and returned as errors.
     */
    const resolvePendingOptions = async (
      changes: CellChange[],
      pendingOptions: PastePendingOptions[],
    ): Promise<{ changes: CellChange[]; errors: ClipboardReport["errors"] }> => {
      if (pendingOptions.length === 0) return { changes, errors: [] };
      const ds = latest.current.dataSource;
      const failedCells = new Map<string, string>();
      const idsByColumn = new Map<string, Map<string, string>>();

      if (!ds.createOption) {
        for (const p of pendingOptions) failedCells.set(pairKey(p.rowId, p.columnId), "This grid can't create new options");
      } else {
        const distinct = new Map<string, { columnId: string; label: string }>();
        for (const p of pendingOptions) {
          for (const label of p.labels) distinct.set(pairKey(p.columnId, label), { columnId: p.columnId, label });
        }
        const entries = [...distinct.values()];
        const settled = await Promise.allSettled(entries.map((e) => ds.createOption?.(e.columnId, e.label) as Promise<Option>));
        const failedLabels = new Map<string, string>();
        settled.forEach((result, i) => {
          const entry = entries[i];
          if (!entry) return;
          if (result.status === "rejected") {
            const reason: unknown = result.reason;
            failedLabels.set(
              pairKey(entry.columnId, entry.label),
              reason instanceof Error && reason.message ? reason.message : `Couldn't create option "${entry.label}"`,
            );
            return;
          }
          let ids = idsByColumn.get(entry.columnId);
          if (!ids) {
            ids = new Map();
            idsByColumn.set(entry.columnId, ids);
          }
          ids.set(entry.label, result.value.id);
          try {
            latest.current.events?.()?.onOptionCreate?.(entry.columnId, result.value);
          } catch (e) {
            console.error(e);
          }
        });
        for (const p of pendingOptions) {
          for (const label of p.labels) {
            const message = failedLabels.get(pairKey(p.columnId, label));
            if (message !== undefined) {
              failedCells.set(pairKey(p.rowId, p.columnId), message);
              break;
            }
          }
        }
      }

      const errors: ClipboardReport["errors"] = [];
      const out: CellChange[] = [];
      const pendingCells = new Set(pendingOptions.map((p) => pairKey(p.rowId, p.columnId)));
      for (const c of changes) {
        const k = pairKey(c.rowId, c.columnId);
        const message = failedCells.get(k);
        if (message !== undefined) {
          errors.push({ rowId: c.rowId, columnId: c.columnId, message });
          continue;
        }
        const ids = idsByColumn.get(c.columnId);
        out.push(pendingCells.has(k) && ids ? { ...c, next: swapLabels(c.next, ids) } : c);
      }
      return { changes: out, errors };
    };

    const paste = async (text: string): Promise<ClipboardReport | null> => {
      const gridApi = api();
      if (!gridApi) return null;
      const target = currentTarget(gridApi);
      if (!target) return null;
      if (isEmptyPaste(text)) {
        announce(NOTHING_TO_PASTE);
        return null;
      }
      try {
        const o = latest.current;
        const columnsById = new Map(o.schema.columns.map((c) => [c.id, c]));
        const plan = planPaste<Row>({
          matrix: parseTsv(text),
          anchor: target.anchor,
          selection: target.selection,
          displayedColIds: displayedColIds(gridApi),
          rowCount: gridApi.getDisplayedRowCount(),
          getRowAt: getRowAt(gridApi),
          columnsById,
          registry: o.registry,
          canEditCell: (row, columnId) => latest.current.canEditCell(row, columnId),
        });
        const resolved = await resolvePendingOptions(plan.changes, plan.pendingOptions);
        if (!active) return null;
        const planningErrors = [...plan.errors, ...resolved.errors];
        if (planningErrors.length > 0) {
          latest.current.cellStatus.setErrors(
            planningErrors.map((e) => ({ cell: { rowId: e.rowId, columnId: e.columnId }, message: e.message })),
          );
        }
        const errors = [...planningErrors];
        let pastedCells = 0;
        let conflicts = 0;
        let skippedReadOnly = plan.skippedReadOnly;
        if (resolved.changes.length > 0) {
          const outcome = await latest.current.controller.submit(resolved.changes, "paste");
          const counts = pasteOutcomeCounts(outcome);
          pastedCells = counts.pastedCells;
          conflicts = counts.conflicts;
          skippedReadOnly += counts.skippedReadOnly;
          errors.push(...counts.errors);
        }
        if (!active) return null;
        const report: ClipboardReport = { pastedCells, skippedReadOnly, conflicts, errors };
        latest.current.onClipboardReport?.(report);
        announce(pasteSummaryMessage(report));
        return report;
      } catch (e) {
        console.error(e);
        announce(PASTE_FAILED, "assertive");
        return null;
      }
    };

    /** A copy event reached us: returns true when the grid took it. */
    const takeCopy = (event: ClipboardEventLike): boolean => {
      cancelPending();
      if (!active || !event.clipboardData || blocked(event.target) || !selectionAllowsOverride()) return false;
      const text = copyText();
      if (text === null) return false;
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      return true;
    };

    /** A paste event reached us: returns true when the grid took it. */
    const takePaste = (event: ClipboardEventLike): boolean => {
      cancelPending();
      if (!active || !event.clipboardData || blocked(event.target) || !hasTarget()) return false;
      if (!hasPlainText(event.clipboardData)) {
        announce(NOTHING_TO_PASTE);
        return false;
      }
      const text = event.clipboardData.getData("text/plain");
      event.preventDefault();
      void paste(text);
      return true;
    };

    const fallback = (kind: Kind): void => {
      if (!active || isGridEditing(api())) return;
      const clipboard = systemClipboard();
      if (kind === "copy") {
        const text = copyText();
        if (text === null) return;
        if (!clipboard?.writeText) {
          announce(COPY_FAILED, "assertive");
          return;
        }
        clipboard.writeText(text).catch(() => announce(COPY_FAILED, "assertive"));
        return;
      }
      if (!clipboard?.readText) {
        announce(PASTE_FAILED, "assertive");
        return;
      }
      clipboard.readText().then(
        (text) => {
          if (active) void paste(text);
        },
        () => announce(PASTE_FAILED, "assertive"),
      );
    };

    /** Arms the one-shot document capture listener + the async fallback for this keystroke. */
    const arm = (kind: Kind): void => {
      cancelPending();
      const listener = (e: Event): void => {
        const activeEl = document.activeElement;
        if (!root || !activeEl || !root.contains(activeEl) || isEditableTarget(activeEl)) {
          cancelPending();
          return;
        }
        const event = e as ClipboardEvent;
        const taken = kind === "copy" ? takeCopy(event) : takePaste(event);
        if (taken) e.stopPropagation();
      };
      document.addEventListener(kind, listener, true);
      const timer = setTimeout(() => {
        cancelPending();
        fallback(kind);
      }, 0);
      pending = { kind, timer, listener };
    };

    const onRootKeyDown: RootKeyHandler = (event) => {
      const isCopy = matchesShortcut(event, COPY);
      const isPaste = !isCopy && matchesShortcut(event, PASTE);
      if (!isCopy && !isPaste) return false;
      if (event.repeat || !active || blocked(event.target) || !hasTarget()) return false;
      arm(isCopy ? "copy" : "paste");
      return "handled-no-prevent";
    };

    const onBefore = (e: Event): void => {
      if (!isEditableTarget(e.target) && !isGridEditing(api())) e.preventDefault();
    };

    const rootRef = (element: HTMLElement | null): void => {
      if (root === element) return;
      if (root) {
        root.removeEventListener("beforecopy", onBefore);
        root.removeEventListener("beforepaste", onBefore);
      }
      root = element;
      if (root) {
        root.addEventListener("beforecopy", onBefore);
        root.addEventListener("beforepaste", onBefore);
      }
    };

    return {
      onCopy: (event) => void takeCopy(event),
      onPaste: (event) => void takePaste(event),
      onRootKeyDown,
      rootRef,
      copyText,
      paste,
      setActive(next) {
        active = next;
        if (!next) cancelPending();
      },
    };
  });

  const { keyboard } = options;
  useEffect(() => {
    handlers.setActive(true);
    const unregister = keyboard.registerRoot(handlers.onRootKeyDown);
    return () => {
      unregister();
      handlers.setActive(false);
    };
  }, [keyboard, handlers]);

  return handlers;
}
