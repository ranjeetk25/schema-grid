/**
 * Keyboard plumbing shared by the grid's interactive features (range
 * selection T23, clipboard T24, undo/redo T26, ...).
 *
 * Contract
 * - Cell-level keys go through AG Grid's `colDef.suppressKeyboardEvent`. A
 *   feature registers a `GridKeyHandler` on the grid's `KeyboardRegistry`
 *   (`registry.register(handler)`, returns an unregister function; register in
 *   an effect). The registry's `suppressKeyboardEvent` is ONE stable function
 *   that `useSchemaGrid` installs on every column (composed with any column
 *   specific one, e.g. longText's, via `withSuppressKeyboardEvent`). Handlers
 *   run in registration order; the first returning `true` wins: the grid's
 *   default handling of that key is suppressed and later handlers are skipped.
 *   AG Grid calls it for `keydown` only, with `params.editing` set while a cell
 *   editor is open; a handler that must not act while editing checks it.
 *   The DOM event still bubbles after a handler returns true; call
 *   `preventDefault()` yourself when the browser default must not run.
 * - Root-level keys (keydown anywhere inside `.sg-root`, including outside
 *   cells) go through `registry.registerRoot(handler)`; `<SchemaGrid>` wires
 *   `registry.handleRootKeyDown` as the root element's `onKeyDown`. Same
 *   first-true-wins rule; a `true` result calls `preventDefault()`.
 * - `createSuppressKeyboardEvent(handlers)` is the pure composition used by the
 *   registry, for callers that have a fixed handler list.
 * - Helpers: `isModKey` (Ctrl, or Cmd on macOS), `matchesShortcut`,
 *   `arrowDirection`, `isEditableTarget` (inputs/textareas/contenteditable,
 *   i.e. an open editor), `isGridEditing(api)`.
 */
import type { ColDef, GridApi, SuppressKeyboardEventParams } from "ag-grid-community";
import type { ExtendDirection } from "../range/geometry";

/** Returns true when it handled the key (the grid's default handling is then suppressed). */
export type GridKeyHandler<Row = unknown> = (params: SuppressKeyboardEventParams<Row>) => boolean;

/** Root keydown handler; `event` is the native KeyboardEvent. Returns true when handled. */
export type RootKeyHandler = (event: KeyboardEvent) => boolean;

export type SuppressKeyboardEventFn<Row = unknown> = (params: SuppressKeyboardEventParams<Row>) => boolean;

export interface KeyboardRegistry<Row = unknown> {
  /** Adds a cell-level handler; returns its unregister function. */
  register(handler: GridKeyHandler<Row>): () => void;
  /** Adds a root-level keydown handler; returns its unregister function. */
  registerRoot(handler: RootKeyHandler): () => void;
  /** Stable; install as `colDef.suppressKeyboardEvent`. */
  suppressKeyboardEvent: SuppressKeyboardEventFn<Row>;
  /** Stable; install as the `.sg-root` element's keydown handler (React or native event). */
  handleRootKeyDown(event: KeyboardEvent | { nativeEvent: KeyboardEvent }): void;
}

/** Composes handlers: first `true` wins. `handlers` may be a getter for a live list. */
export function createSuppressKeyboardEvent<Row = unknown>(
  handlers: readonly GridKeyHandler<Row>[] | (() => readonly GridKeyHandler<Row>[]),
): SuppressKeyboardEventFn<Row> {
  return (params) => {
    const list = typeof handlers === "function" ? handlers() : handlers;
    for (const handler of list) {
      if (handler(params)) return true;
    }
    return false;
  };
}

export function createKeyboardRegistry<Row = unknown>(): KeyboardRegistry<Row> {
  let cellHandlers: GridKeyHandler<Row>[] = [];
  let rootHandlers: RootKeyHandler[] = [];
  return {
    register(handler) {
      cellHandlers = [...cellHandlers, handler];
      return () => {
        cellHandlers = cellHandlers.filter((h) => h !== handler);
      };
    },
    registerRoot(handler) {
      rootHandlers = [...rootHandlers, handler];
      return () => {
        rootHandlers = rootHandlers.filter((h) => h !== handler);
      };
    },
    suppressKeyboardEvent: createSuppressKeyboardEvent<Row>(() => cellHandlers),
    handleRootKeyDown(event) {
      const native = "nativeEvent" in event ? event.nativeEvent : event;
      for (const handler of rootHandlers) {
        if (handler(native)) {
          native.preventDefault();
          return;
        }
      }
    },
  };
}

/**
 * Returns `defs` with `suppressKeyboardEvent` composed with `suppress`: a
 * column's own function (e.g. longText's) runs first. New objects; `defs` is
 * not mutated.
 */
export function withSuppressKeyboardEvent<Row>(
  defs: readonly ColDef<Row>[],
  suppress: SuppressKeyboardEventFn<Row>,
): ColDef<Row>[] {
  return defs.map((def) => {
    const own = def.suppressKeyboardEvent;
    return {
      ...def,
      suppressKeyboardEvent: own ? (p: SuppressKeyboardEventParams<Row>) => own(p) || suppress(p) : suppress,
    };
  });
}

const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");

/** Ctrl, or Cmd on macOS. */
export function isModKey(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">): boolean {
  return isMac() ? event.metaKey || event.ctrlKey : event.ctrlKey;
}

export interface Shortcut {
  /** Compared case-insensitively against `event.key`. */
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Exact modifier match (an unspecified modifier must be up). */
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;
  if (isModKey(event) !== !!shortcut.mod) return false;
  if (event.shiftKey !== !!shortcut.shift) return false;
  return event.altKey === !!shortcut.alt;
}

const ARROWS: Record<string, ExtendDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function arrowDirection(key: string): ExtendDirection | null {
  return ARROWS[key] ?? null;
}

/** True when the event target is a text input/textarea/select/contenteditable (an open editor). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  return el.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']") !== null;
}

export function isGridEditing(api: Pick<GridApi, "getEditingCells"> | null | undefined): boolean {
  return !!api && api.getEditingCells().length > 0;
}
