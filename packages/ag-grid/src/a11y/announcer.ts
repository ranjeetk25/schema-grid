/**
 * A tiny framework-free store behind the grid's ARIA live regions.
 *
 * Re-announcing: screen readers only speak a live region when its text
 * CHANGES, so announcing the same message twice in a row would be silent.
 * Each announcement whose text equals the region's current (unmarked) text
 * toggles a trailing zero-width space (U+200B) — the visible/audible text is
 * identical, but the DOM text differs, so it is spoken again. This is
 * synchronous (no clear-then-set timer). Use `stripAnnouncementMarker` to
 * compare region text in tests.
 *
 * Message builders (T30): every user-facing announcement wording lives here
 * so it stays consistent. `useClipboard` and `useFillHandle` re-export their
 * builders from this module.
 *   - commit (polite):     "Saved" / "Saved N cells"
 *   - conflict (assertive): "Conflict on {column}, row {id}" / "Conflicts on N cells"
 *   - rejected (assertive): "Edit rejected on {column}: {reason}" / "N edits rejected"
 *   - veto (assertive):     "Edit cancelled"
 *   - paste (polite):       "Paste: N pasted, M skipped, K errors[, C conflicts]"
 *   - fill (polite):        "Fill: N cells filled[, M read-only cells skipped][, saved]"
 *     (announced once the fill's save settles; fill batches get no separate "Saved")
 */
import type { ClipboardReport } from "../clipboard/types";
import type { ChangeSource } from "../internal/core";

export type Politeness = "polite" | "assertive";

export interface AnnouncerState {
  polite: string;
  assertive: string;
}

export interface Announcer {
  announce(message: string, politeness?: Politeness): void;
  subscribe(listener: () => void): () => void;
  /** Stable snapshot between announcements (safe for `useSyncExternalStore`). */
  getState(): AnnouncerState;
}

const MARKER = "​";

export function stripAnnouncementMarker(text: string): string {
  return text.split(MARKER).join("");
}

/** "Saved" for one cell, "Saved N cells" otherwise. */
export function savedMessage(count: number): string {
  return count === 1 ? "Saved" : `Saved ${count} cells`;
}

/** One conflicting cell. */
export function conflictMessage(columnLabel: string, rowId: string): string {
  return `Conflict on ${columnLabel}, row ${rowId}`;
}

/** Several conflicting cells in one batch. */
export function conflictsMessage(count: number): string {
  return `Conflicts on ${count} cells`;
}

/** One cell the data source rejected (error) — `reason` is the server's message. */
export function editRejectedMessage(columnLabel: string, reason: string): string {
  return `Edit rejected on ${columnLabel}: ${reason}`;
}

/** Several rejected cells in one batch. */
export function editsRejectedMessage(count: number): string {
  return count === 1 ? "1 edit rejected" : `${count} edits rejected`;
}

/** A `beforeCellsChange` veto. */
export const EDIT_CANCELLED = "Edit cancelled";

/** "Paste: N pasted, M skipped, K errors", plus ", C conflicts" when there were any. */
export function pasteSummaryMessage(report: ClipboardReport): string {
  const base = `Paste: ${report.pastedCells} pasted, ${report.skippedReadOnly} skipped, ${report.errors.length} errors`;
  return report.conflicts > 0 ? `${base}, ${report.conflicts} conflicts` : base;
}

/**
 * "Fill: 3 cells filled, 1 read-only cell skipped"; null when nothing happened.
 * With `saved` (cells the data source applied, once the fill's save settled)
 * the save is folded in — ", saved" when all were, ", N saved" when some
 * were — so ONE polite message carries both (a separate "Saved N cells"
 * would overwrite the summary in the live region).
 */
export function fillMessage(filled: number, skipped: number, saved?: number): string | null {
  if (filled === 0 && skipped === 0) return null;
  const parts = [`${filled} ${filled === 1 ? "cell" : "cells"} filled`];
  if (skipped > 0) parts.push(`${skipped} read-only ${skipped === 1 ? "cell" : "cells"} skipped`);
  if (saved !== undefined && saved > 0) parts.push(saved >= filled ? "saved" : `${saved} saved`);
  return `Fill: ${parts.join(", ")}`;
}

/**
 * The polite "Saved" announcement for an applied batch, or null when there is
 * none to make: nothing applied, or a `"fill"` batch (the fill handle
 * announces one combined "Fill: N cells filled, saved" itself).
 */
export function savedAnnouncement(source: ChangeSource, count: number): string | null {
  if (count <= 0 || source === "fill") return null;
  return savedMessage(count);
}

export function createAnnouncer(): Announcer {
  let state: AnnouncerState = { polite: "", assertive: "" };
  const listeners = new Set<() => void>();
  return {
    announce(message, politeness = "polite") {
      const current = state[politeness];
      const next =
        stripAnnouncementMarker(current) === message && !current.endsWith(MARKER) ? `${message}${MARKER}` : message;
      state = { ...state, [politeness]: next };
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
  };
}
