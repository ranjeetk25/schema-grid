import { useCallback, useRef, useState } from "react";
import type { ChangeConflict } from "../internal/core-contracts";
import type { ConflictResolution, SchemaGridEvents } from "../internal/grid-contracts";

type Resolve = (resolution: ConflictResolution) => Promise<void>;

interface QueuedConflict {
  conflict: ChangeConflict;
  resolve: Resolve;
}

export interface ShadcnConflictPrompt {
  /** Pass as `events.onConflict` to `SchemaGrid` / `useSchemaGrid`. */
  onConflict: NonNullable<SchemaGridEvents["onConflict"]>;
  /** The conflict to show now (first in the queue), or null. */
  conflict: ChangeConflict | null;
  /** Whether the prompt should be open (false after `dismiss` until `reopen` or a new conflict). */
  opened: boolean;
  /** Conflicts still waiting for a decision, including the current one. */
  pendingCount: number;
  /** Resolve the current conflict through ag-grid's `resolve` callback and advance the queue. */
  resolve(resolution: ConflictResolution): Promise<void>;
  /** Close without resolving (Escape / outside click). The conflict stays queued. */
  dismiss(): void;
  reopen(): void;
}

/**
 * Queues `SchemaGridEvents.onConflict(conflict, resolve)` calls one at a time
 * for a `ConflictPopover`:
 * `<ConflictPopover conflict={p.conflict} opened={p.opened} onResolve={p.resolve} onClose={p.dismiss} …/>`.
 */
export function useShadcnConflictPrompt(): ShadcnConflictPrompt {
  const [queue, setQueue] = useState<QueuedConflict[]>([]);
  const [opened, setOpened] = useState(false);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const onConflict = useCallback((conflict: ChangeConflict, resolve: Resolve) => {
    setQueue((q) => [...q, { conflict, resolve }]);
    setOpened(true);
  }, []);

  const resolve = useCallback(async (resolution: ConflictResolution) => {
    const current = queueRef.current[0];
    if (!current) return;
    queueRef.current = queueRef.current.slice(1);
    setQueue((q) => (q[0] === current ? q.slice(1) : q));
    await current.resolve(resolution);
  }, []);

  const dismiss = useCallback(() => setOpened(false), []);
  const reopen = useCallback(() => setOpened(true), []);

  const current = queue[0] ?? null;
  return {
    onConflict,
    conflict: current?.conflict ?? null,
    opened: opened && current !== null,
    pendingCount: queue.length,
    resolve,
    dismiss,
    reopen,
  };
}
