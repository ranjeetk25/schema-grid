import { type ReactNode, useInsertionEffect } from "react";
import { ensureEditorStyles } from "./editorStyles";

export const EDITOR_CARD_MIN_WIDTH = 240;

/**
 * The opaque card a popup editor lives in: surface background, 1px hairline,
 * 8px radius, the theme's popup shadow and 4px padding. At least as wide as
 * the edited cell and never narrower than 240px; content (pills, lists)
 * wraps inside it.
 */
export function EditorCard({ cellWidth, children }: { cellWidth?: number; children?: ReactNode }) {
  useInsertionEffect(ensureEditorStyles, []);
  const minWidth = Math.max(EDITOR_CARD_MIN_WIDTH, Math.ceil(cellWidth ?? 0));
  return (
    <div
      className="sg-ed-card"
      data-testid="editor-card"
      // Content width inside the 4px padding + 1px border; widgets size themselves from it.
      style={{ minWidth, width: "max-content", maxWidth: Math.max(480, minWidth), ["--sg-ed-width" as string]: `${minWidth - 10}px` }}
    >
      {children}
    </div>
  );
}

/** Loads the shared editor stylesheet (for widgets that use the `sg-ed-*` classes outside a card). */
export function useEditorStyles(): void {
  useInsertionEffect(ensureEditorStyles, []);
}
