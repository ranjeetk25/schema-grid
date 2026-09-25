/**
 * Keyboard plumbing shared by the grid's interactive features (range
 * selection T23, clipboard T24, fill T25, undo/redo T26, ...).
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
 *   `preventDefault()` yourself when the browser default must not run (a
 *   prevented event is then skipped by the root handlers, see below).
 * - Root-level keys (keydown anywhere inside `.sg-root`, including outside
 *   cells) go through `registry.registerRoot(handler, options?)`;
 *   `<SchemaGrid>` wires `registry.handleRootKeyDown` as the root element's
 *   `onKeyDown`. A root handler returns a `RootKeyResult`:
 *     - `"handled"` (or `true`, kept as an alias): claims the key and the
 *       registry calls `preventDefault()`;
 *     - `"handled-no-prevent"`: claims the key, the browser default still runs
 *       (e.g. paste letting the native `paste` event fire);
 *     - `false` / `undefined`: not handled, the next handler runs.
 *   First claim wins. By default a root handler is SKIPPED when the event is
 *   already `defaultPrevented`, its target is an editable element
 *   (`isEditableTarget`) or a cell editor is open (`isGridEditing` of the api
 *   from `createKeyboardRegistry({ getApi })`); `registerRoot(handler,
 *   { whileEditing: true })` opts a handler into all of those cases.
 * - `createSuppressKeyboardEvent(handlers)` is the pure composition used by the
 *   registry, for callers that have a fixed handler list.
 * - Helpers: `isModKey` (Ctrl, or Cmd on macOS), `matchesShortcut` (falls back
 *   to `event.code`, e.g. "KeyC", for non-Latin layouts), `arrowDirection`,
 *   `isEditableTarget` (inputs/textareas/contenteditable, i.e. an open editor),
 *   `isGridEditing(api)`.
 */
import type { ColDef, GridApi, SuppressKeyboardEventParams } from "ag-grid-community";
import type { ExtendDirection } from "../range/geometry";

/** Returns true when it handled the key (the grid's default handling is then suppressed). */
export type GridKeyHandler<Row = unknown> = (params: SuppressKeyboardEventParams<Row>) => boolean;

/** `true` is an alias of `"handled"`. */
export type RootKeyResult = "handled" | "handled-no-prevent" | boolean | undefined | void;

/** Root keydown handler; `event` is the native KeyboardEvent. */
export type RootKeyHandler = (event: KeyboardEvent) => RootKeyResult;

export interface RootKeyHandlerOptions {
  /** Also run when a cell editor is open, the target is editable or the event is already prevented. */
  whileEditing?: boolean;
}

export type SuppressKeyboardEventFn<Row = unknown> = (params: SuppressKeyboardEventParams<Row>) => boolean;

export interface KeyboardRegistry<Row = unknown> {
  /** Adds a cell-level handler; returns its unregister function. */
  register(handler: GridKeyHandler<Row>): () => void;
  /** Adds a root-level keydown handler; returns its unregister function. */
  registerRoot(handler: RootKeyHandler, options?: RootKeyHandlerOptions): () => void;
  /** Stable; install as `colDef.suppressKeyboardEvent`. */
  suppressKeyboardEvent: SuppressKeyboardEventFn<Row>;
  /** Stable; install as the `.sg-root` element's keydown handler (React or native event). */
  handleRootKeyDown(event: KeyboardEvent | { nativeEvent: KeyboardEvent }): void;
}

export interface KeyboardRegistryOptions {
  /** The grid api, for the "cell editor open" check of root handlers. */
  getApi?(): Pick<GridApi, "getEditingCells"> | null | undefined;
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

export function createKeyboardRegistry<Row = unknown>(options: KeyboardRegistryOptions = {}): KeyboardRegistry<Row> {
  let cellHandlers: GridKeyHandler<Row>[] = [];
  let rootHandlers: { handler: RootKeyHandler; whileEditing: boolean }[] = [];
  return {
    register(handler) {
      cellHandlers = [...cellHandlers, handler];
      return () => {
        cellHandlers = cellHandlers.filter((h) => h !== handler);
      };
    },
    registerRoot(handler, opts = {}) {
      const entry = { handler, whileEditing: opts.whileEditing === true };
      rootHandlers = [...rootHandlers, entry];
      return () => {
        rootHandlers = rootHandlers.filter((h) => h !== entry);
      };
    },
    suppressKeyboardEvent: createSuppressKeyboardEvent<Row>(() => cellHandlers),
    handleRootKeyDown(event) {
      const native = "nativeEvent" in event ? event.nativeEvent : event;
      let blocked: boolean | undefined;
      const isBlocked = (): boolean => {
        blocked ??=
          native.defaultPrevented || isEditableTarget(native.target) || isGridEditing(options.getApi?.() ?? null);
        return blocked;
      };
      for (const { handler, whileEditing } of rootHandlers) {
        if (!whileEditing && isBlocked()) continue;
        const result = handler(native);
        if (result === "handled-no-prevent") return;
        if (result === "handled" || result === true) {
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

/**
 * Exact modifier match (an unspecified modifier must be up). A single-letter
 * `key` also matches `event.code` "Key<LETTER>" (non-Latin keyboard layouts).
 */
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const want = shortcut.key.toLowerCase();
  const byKey = (event.key ?? "").toLowerCase() === want;
  const byCode = /^[a-z]$/.test(want) && event.code === `Key${want.toUpperCase()}`;
  if (!byKey && !byCode) return false;
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
/** Text-like inputs only: checkboxes, radios, buttons etc. don't take text keys or clipboard. */
const TEXT_INPUT = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]
  .reduce((sel, t) => `${sel}:not([type='${t}'])`, "input");

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  return el.closest(`${TEXT_INPUT}, textarea, select, [contenteditable='true'], [contenteditable='']`) !== null;
}

export function isGridEditing(api: Pick<GridApi, "getEditingCells"> | null | undefined): boolean {
  return !!api && api.getEditingCells().length > 0;
}
