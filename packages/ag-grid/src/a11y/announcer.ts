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
 */

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
