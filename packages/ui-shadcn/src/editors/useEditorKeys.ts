import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/** `autoFocus !== false` = the widget is a grid cell editor (focus + auto-open); `false` = form / filter mode. */
export const isGridMode = (autoFocus: boolean | undefined): boolean => autoFocus !== false;

/** Focuses `ref` on mount in grid mode, caret at the end. Never grabs focus in form/filter mode. */
export function useAutoFocus(ref: RefObject<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | null>, autoFocus: boolean | undefined) {
  useEffect(() => {
    if (autoFocus === false) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    if ((el instanceof HTMLInputElement && el.type === "text") || el instanceof HTMLTextAreaElement) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, [autoFocus, ref]);
}

/**
 * A NATIVE keydown listener on `element`.
 *
 * AG Grid listens for keydown natively on an ancestor of every cell / popup
 * editor and ends the edit on Enter (with the last reported value) before
 * React's root-delegated handlers run. Anything that must own Enter (pick a
 * highlighted option, insert a newline, block an invalid commit) therefore
 * has to handle it here and `stopPropagation()` — which also keeps the event
 * from React, so the handler must do the work itself.
 */
export function useNativeKeyDown(element: HTMLElement | null, handler: (event: KeyboardEvent) => void, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!element || !enabled) return;
    const listener = (event: KeyboardEvent) => handlerRef.current(event);
    element.addEventListener("keydown", listener);
    return () => element.removeEventListener("keydown", listener);
  }, [element, enabled]);
}

/** `useNativeKeyDown` for an element that is always rendered (read from `ref` after mount). */
export function useNativeKeyDownRef(ref: RefObject<HTMLElement | null>, handler: (event: KeyboardEvent) => void) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setElement(ref.current);
  }, [ref]);
  useNativeKeyDown(element, handler);
}

/** A stable ref callback that also exposes the node as state (for effects that need the mounted element). */
export function useElement<T extends HTMLElement>(): [T | null, (node: T | null) => void] {
  const [node, setNode] = useState<T | null>(null);
  return [node, setNode];
}

const CMDK_SELECT_EVENT = "cmdk-item-select";

/** Picks cmdk's highlighted (enabled) item under `root`, if any. Returns whether one was picked. */
export function pickHighlightedItem(root: Element): boolean {
  const item = root.querySelector('[cmdk-item][aria-selected="true"]:not([aria-disabled="true"])');
  if (!item) return false;
  item.dispatchEvent(new Event(CMDK_SELECT_EVENT));
  return true;
}

/**
 * Enter on a highlighted cmdk option picks it at the source (native listener
 * on the Command root) and never reaches AG Grid, which would otherwise end
 * the edit with the old value first. Enter with nothing highlighted is left
 * alone (it reaches the grid / the React handlers).
 */
export function useCmdkEnter(root: HTMLElement | null, onPicked?: () => void) {
  useNativeKeyDown(root, (event) => {
    if (event.key !== "Enter" || event.isComposing || event.metaKey || event.ctrlKey) return;
    if (!root || !pickHighlightedItem(root)) return;
    event.preventDefault();
    event.stopPropagation();
    onPicked?.();
  });
}

const NONE_A = "\u0000sg-none-a";
const NONE_B = "\u0000sg-none-b";
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * Controls cmdk's highlighted item so nothing is highlighted until the user
 * asks for it — matching the Mantine combobox: arrows / pointer highlight,
 * and while searching (`autoHighlight()` true) the first match is
 * highlighted so Enter picks it. cmdk otherwise always highlights the first
 * item, which would make Enter pick an option the user never chose.
 */
export function useCmdkHighlight(autoHighlight: () => boolean) {
  const [value, setValue] = useState(NONE_A);
  const intent = useRef(false);
  const autoRef = useRef(autoHighlight);
  autoRef.current = autoHighlight;

  const clear = useCallback(() => setValue((v) => (v === NONE_A ? NONE_B : NONE_A)), []);
  const markIntent = useCallback(() => {
    intent.current = true;
    queueMicrotask(() => {
      intent.current = false;
    });
  }, []);
  const onValueChange = useCallback(
    (next: string) => {
      if (intent.current || autoRef.current()) {
        intent.current = false;
        setValue(next);
      } else {
        // Reject cmdk's automatic pick: flip the sentinel so cmdk re-reads it.
        clear();
      }
    },
    [clear],
  );
  const onKeyDownCapture = useCallback(
    (event: { key: string; ctrlKey: boolean }) => {
      if (NAV_KEYS.has(event.key) || (event.ctrlKey && "njpk".includes(event.key))) markIntent();
    },
    [markIntent],
  );

  return {
    /** Spread on `<Command>`. */
    rootProps: { value, onValueChange, onKeyDownCapture },
    /** Spread on `<CommandList>`: hover / click highlight is intentional. */
    listProps: { onPointerMoveCapture: markIntent, onClickCapture: markIntent },
    clear,
  };
}

/** Mantine-style debounced value: the first value immediately, later changes after `ms`. */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** `true` after mount, `false` after unmount — for async continuations. */
export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
