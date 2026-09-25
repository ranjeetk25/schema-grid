/**
 * Tracks `document.visibilityState`, so callers (e.g. `usePollingSync`) can
 * pause work while the tab is hidden. SSR-safe: returns `true` when there is
 * no `document`.
 */
import { useEffect, useState } from "react";

function isVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(isVisible);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleChange = (): void => setVisible(isVisible());
    handleChange();
    document.addEventListener("visibilitychange", handleChange);
    return () => document.removeEventListener("visibilitychange", handleChange);
  }, []);

  return visible;
}
