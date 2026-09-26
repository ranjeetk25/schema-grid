import type { ServerWarning } from "../context";
import type { CellChange, ChangeConflict, ChangeError, ChangeMeta, GridRow } from "../internal/core";

/**
 * What a write committed (v0.3.1), handed to the `afterCommit` hooks of
 * `createDrizzleDataSource` and `createSqlViewDataSource` once the transaction
 * has resolved. The `applyChanges` branch mirrors the `ChangeResult` the caller
 * receives (same arrays, not copies) plus the batch's input `meta`.
 */
export type CommitOutcome =
  | {
      kind: "applyChanges";
      applied: CellChange[];
      rejected: CellChange[];
      errors: ChangeError[];
      conflicts: ChangeConflict[];
      meta?: ChangeMeta;
      /** `ChangeResult.rows`: the batch's rows as re-read inside the transaction (`[]` when none survived). */
      rows: GridRow[];
    }
  | { kind: "createRows"; created: GridRow[] }
  | { kind: "deleteRows"; deletedIds: string[] };

export type CommitOp = CommitOutcome["kind"];

/** The post-commit hook shape both sources accept; `Ctx` is what the source hands its other hooks. */
export type AfterCommitHook<Ctx> = (ctx: Ctx, outcome: CommitOutcome) => void | Promise<void>;

/**
 * Runs `hook` (when given) AFTER the write's transaction resolved, awaits it, and
 * never lets it fail the call: a sync throw or a rejection becomes
 * `onWarning({ code: "AFTER_COMMIT_FAILED", op, error })`, or `console.error`
 * without a warning sink. Callers pass the NON-transactional context.
 */
export async function runAfterCommit<Ctx>(
  hook: AfterCommitHook<Ctx> | undefined,
  ctx: Ctx,
  outcome: CommitOutcome,
  onWarning?: (w: ServerWarning) => void,
): Promise<void> {
  if (!hook) return;
  try {
    await hook(ctx, outcome);
  } catch (error) {
    const warning: ServerWarning = { code: "AFTER_COMMIT_FAILED", op: outcome.kind, error };
    try {
      if (onWarning) onWarning(warning);
      else console.error(`[schema-grid] AFTER_COMMIT_FAILED: afterCommit hook threw after ${outcome.kind}`, error);
    } catch (sinkError) {
      console.error("[schema-grid] AFTER_COMMIT_FAILED: onWarning threw", sinkError, "original error:", error);
    }
  }
}
