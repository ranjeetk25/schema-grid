/**
 * Undo/redo keybindings (T26): Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and
 * Ctrl+Y redo, registered on the grid's root `KeyboardRegistry`
 * (`grid/keyboard.ts`).
 *
 * The actual undo/redo pipeline (recording on `useSchemaGrid`'s edit
 * controller `onApplied`, replaying inverted changes through
 * `controller.submit(changes, "undo" | "redo")`, and conflicts routed to
 * `events.onConflict`) already lives in `useSchemaGrid`'s `undo:
 * SchemaGridUndo`. This hook is purely the keyboard trigger for it.
 *
 * Ignored while a cell editor is open or the event target is itself an
 * editable element (belt and braces: both `isGridEditing(api)` and
 * `isEditableTarget(event.target)` are checked here, on top of whatever
 * automatic editing guard the registry itself applies to root handlers).
 *
 * Announces via the `announce` seam: "Undone" / "Redone" on success,
 * "Nothing to undo" / "Nothing to redo" when the respective stack is empty.
 */
import type { GridApi } from "ag-grid-community";
import { type RefObject, useEffect, useState } from "react";
import type { Politeness } from "../a11y/announcer";
import { isEditableTarget, isGridEditing, type KeyboardRegistry, matchesShortcut, type RootKeyHandler } from "../grid/keyboard";
import type { SchemaGridUndo } from "../grid/useSchemaGrid";

export interface UseUndoKeybindingsOptions<Row = unknown> {
  apiRef: RefObject<GridApi<Row> | null>;
  /** The Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y root handler is registered on it for the hook's lifetime. */
  keyboard: KeyboardRegistry<Row>;
  undo: SchemaGridUndo;
  announce?(message: string, politeness?: Politeness): void;
}

/** Stable for the hook's lifetime. */
export interface UndoKeybindingsHandlers {
  /** Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y handler (already registered on `keyboard`). */
  onRootKeyDown: RootKeyHandler;
}

const UNDO = { key: "z", mod: true } as const;
const REDO_SHIFT_Z = { key: "z", mod: true, shift: true } as const;
const REDO_Y = { key: "y", mod: true } as const;

export function useUndoKeybindings<Row = unknown>(options: UseUndoKeybindingsOptions<Row>): UndoKeybindingsHandlers {
  const [latest] = useState(() => ({ current: options }));
  latest.current = options;

  const [handlers] = useState<UndoKeybindingsHandlers>(() => {
    const onRootKeyDown: RootKeyHandler = (event) => {
      const isRedo = matchesShortcut(event, REDO_SHIFT_Z) || matchesShortcut(event, REDO_Y);
      const isUndo = !isRedo && matchesShortcut(event, UNDO);
      if (!isUndo && !isRedo) return false;

      const o = latest.current;
      // Belt and braces: the registry may already skip root handlers while
      // editing/in editable targets, but we never rely on that alone.
      if (isEditableTarget(event.target) || isGridEditing(o.apiRef.current)) return false;

      if (isUndo) {
        if (!o.undo.canUndo()) {
          o.announce?.("Nothing to undo");
          return true;
        }
        void o.undo.undo().then(() => latest.current.announce?.("Undone"));
      } else {
        if (!o.undo.canRedo()) {
          o.announce?.("Nothing to redo");
          return true;
        }
        void o.undo.redo().then(() => latest.current.announce?.("Redone"));
      }
      return true;
    };
    return { onRootKeyDown };
  });

  const { keyboard } = options;
  useEffect(() => keyboard.registerRoot(handlers.onRootKeyDown), [keyboard, handlers]);

  return handlers;
}
