import { type CSSProperties, useSyncExternalStore } from "react";
import type { Announcer } from "./announcer";

/** Visually hidden but exposed to assistive technology. */
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

export interface LiveAnnouncerProps {
  announcer: Announcer;
}

/** Two visually hidden live regions (polite status + assertive alert) fed by an `Announcer`. */
export function LiveAnnouncer({ announcer }: LiveAnnouncerProps) {
  const state = useSyncExternalStore(announcer.subscribe, announcer.getState, announcer.getState);
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: an explicit div live region is announced more reliably than <output>. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sg-live-polite" style={VISUALLY_HIDDEN}>
        {state.polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sg-live-assertive" style={VISUALLY_HIDDEN}>
        {state.assertive}
      </div>
    </>
  );
}
