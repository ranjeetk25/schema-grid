/**
 * Polls `dataSource.getChanges` on a timer, feeding each `ChangeFeedEntry`
 * to `onEntry`. Uses `setTimeout` chaining (never `setInterval`), so a slow
 * request can never overlap the next poll: the next timer is only armed once
 * the previous request settles. Backs off exponentially on error
 * (`intervalMs * 2^consecutiveFailures`, capped at 60s) and resets on the
 * next success.
 *
 * Stable callbacks: `onEntry`/`onError`/`dataSource`/`intervalMs` are read
 * through refs so a caller re-rendering with a fresh closure never resets
 * the running timer. Only `enabled` toggling starts/stops the loop.
 *
 * Generations: every unmount, and every enabled→disabled transition, bumps
 * `activeGenerationRef`. A request captures the generation it was issued
 * under; if that generation is stale by the time it settles (component
 * unmounted, or sync was disabled meanwhile), its result is discarded —
 * no `onEntry`, no state update, no reschedule. This is what stops a
 * request that was in flight at unmount from resurrecting the polling loop.
 * Re-enabling (disabled→enabled, not the initial mount) polls immediately
 * rather than waiting a full interval; if a stale-generation request is
 * still in flight at that point, it's ignored and a fresh one is issued
 * right away — there is never more than one *live-generation* request at
 * once.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeFeedEntry, DataSource, GridRow } from "../internal/core";

const DEFAULT_INTERVAL_MS = 7000;
const MAX_BACKOFF_MS = 60_000;

export interface UsePollingSyncOptions<Row extends GridRow> {
  dataSource: Pick<DataSource<Row>, "getChanges">;
  intervalMs?: number;
  enabled: boolean;
  initialCursor?: string | null;
  onEntry(entry: ChangeFeedEntry<Row>): void;
  onError?(err: unknown): void;
}

export interface UsePollingSyncResult {
  lastCursor: string | null;
  lastError: unknown;
  pollNow(): Promise<void>;
}

export function usePollingSync<Row extends GridRow>(
  options: UsePollingSyncOptions<Row>,
): UsePollingSyncResult {
  const { enabled, initialCursor = null } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  const [lastCursor, setLastCursor] = useState<string | null>(initialCursor);
  const [lastError, setLastError] = useState<unknown>(null);

  const cursorRef = useRef<string | null>(initialCursor);
  const dataSourceRef = useRef(options.dataSource);
  const onEntryRef = useRef(options.onEntry);
  const onErrorRef = useRef(options.onError);
  const intervalMsRef = useRef(intervalMs);
  const enabledRef = useRef(enabled);
  const failuresRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const inFlightGenerationRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on unmount and on every enabled→disabled transition. A request
  // (or a scheduled timer) captures this value at issue time; if it no
  // longer matches when the request settles / the timer fires, it's stale
  // and must not touch state, call onEntry, or reschedule.
  const activeGenerationRef = useRef(0);
  // Distinguishes "just mounted" (wait a full interval before the first
  // poll) from "re-enabled after being disabled" (poll immediately).
  const isInitialEffectRef = useRef(true);
  const wasEnabledRef = useRef(false);

  dataSourceRef.current = options.dataSource;
  onEntryRef.current = options.onEntry;
  onErrorRef.current = options.onError;
  intervalMsRef.current = intervalMs;
  enabledRef.current = enabled;

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Forward declaration via ref so `scheduleNext` and `poll` can call each
  // other without a circular useCallback dependency.
  const pollRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const scheduleNext = useCallback((): void => {
    clearTimer();
    if (!enabledRef.current) return;
    if (!dataSourceRef.current.getChanges) return;
    const gen = activeGenerationRef.current;
    const backoff = Math.min(intervalMsRef.current * 2 ** failuresRef.current, MAX_BACKOFF_MS);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (activeGenerationRef.current !== gen) return; // stale: disabled/unmounted since
      void pollRef.current();
    }, backoff);
  }, [clearTimer]);

  const poll = useCallback((): Promise<void> => {
    const gen = activeGenerationRef.current;
    // Only dedupe against an in-flight request from the SAME generation.
    // A stale-generation in-flight request must not block a fresh one.
    if (inFlightRef.current && inFlightGenerationRef.current === gen) {
      return inFlightRef.current;
    }
    const getChanges = dataSourceRef.current.getChanges;
    if (!getChanges) return Promise.resolve();

    const promise = getChanges(cursorRef.current)
      .then((entry) => {
        if (activeGenerationRef.current !== gen) return; // stale: discard
        cursorRef.current = entry.cursor;
        failuresRef.current = 0;
        setLastCursor(entry.cursor);
        setLastError(null);
        onEntryRef.current(entry);
      })
      .catch((err: unknown) => {
        if (activeGenerationRef.current !== gen) return; // stale: discard
        failuresRef.current += 1;
        setLastError(err);
        onErrorRef.current?.(err);
      })
      .finally(() => {
        if (inFlightGenerationRef.current === gen) {
          inFlightRef.current = null;
          inFlightGenerationRef.current = null;
        }
        if (activeGenerationRef.current === gen) {
          scheduleNext();
        }
      });

    inFlightRef.current = promise;
    inFlightGenerationRef.current = gen;
    return promise;
  }, [scheduleNext]);

  pollRef.current = poll;

  useEffect(() => {
    const isInitial = isInitialEffectRef.current;
    const wasEnabled = wasEnabledRef.current;
    isInitialEffectRef.current = false;
    wasEnabledRef.current = enabled;

    // A fresh generation invalidates any request/timer issued before this
    // effect run (in particular, one left over from a just-torn-down
    // previous run of this same effect, or from a stale earlier mount).
    activeGenerationRef.current += 1;

    if (enabled && dataSourceRef.current.getChanges) {
      if (!isInitial && !wasEnabled) {
        // Re-enabled after being disabled: don't make the caller wait a
        // full interval — poll now (ignoring any stale in-flight request).
        void poll();
      } else {
        scheduleNext();
      }
    } else {
      clearTimer();
    }

    return () => {
      activeGenerationRef.current += 1;
      clearTimer();
    };
  }, [enabled, scheduleNext, clearTimer, poll]);

  const pollNow = useCallback((): Promise<void> => {
    clearTimer();
    return poll();
  }, [poll, clearTimer]);

  return { lastCursor, lastError, pollNow };
}
