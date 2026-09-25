import { useRef } from "react";

/**
 * A key that changes each time `opened` flips to true or the target id
 * changes, so the form body (and its draft) starts fresh per opening. Keyed on
 * the id, not the object: a host re-fetch with an equal column keeps the draft.
 */
export function useOpenKey(opened: boolean, targetId: string | undefined): string {
  const openCount = useRef(0);
  const wasOpen = useRef(false);
  if (opened && !wasOpen.current) openCount.current += 1;
  wasOpen.current = opened;
  return `${openCount.current}:${targetId ?? "new"}`;
}
