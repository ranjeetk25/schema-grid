/**
 * `runAfterCommit` (v0.3.1): the post-commit hook helper both data sources share —
 * awaited, never allowed to change the answer, failures routed to `onWarning`
 * (`AFTER_COMMIT_FAILED`) or `console.error`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CommitOutcome, runAfterCommit } from "../../../src/changes/after-commit";
import type { ServerWarning } from "../../../src/context";

const outcome: CommitOutcome = { kind: "deleteRows", deletedIds: ["1"] };

describe("runAfterCommit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a no-op without a hook", async () => {
    await expect(runAfterCommit(undefined, {}, outcome, () => {})).resolves.toBeUndefined();
  });

  it("awaits the hook and hands it the ctx and the outcome", async () => {
    const seen: unknown[] = [];
    const ctx = { tag: "ctx" };
    await runAfterCommit(
      async (c, o) => {
        await new Promise((r) => setTimeout(r, 1));
        seen.push([c, o]);
      },
      ctx,
      outcome,
      () => {},
    );
    expect(seen).toEqual([[ctx, outcome]]);
  });

  it("a rejecting hook becomes an AFTER_COMMIT_FAILED warning naming the op", async () => {
    const warnings: ServerWarning[] = [];
    const boom = new Error("boom");
    await runAfterCommit(async () => Promise.reject(boom), {}, outcome, (w) => warnings.push(w));
    expect(warnings).toEqual([{ code: "AFTER_COMMIT_FAILED", op: "deleteRows", error: boom }]);
  });

  it("a synchronously throwing hook is caught the same way", async () => {
    const warnings: ServerWarning[] = [];
    await runAfterCommit(
      () => {
        throw new Error("sync");
      },
      {},
      { kind: "createRows", created: [] },
      (w) => warnings.push(w),
    );
    expect(warnings).toMatchObject([{ code: "AFTER_COMMIT_FAILED", op: "createRows" }]);
  });

  it("without onWarning the failure goes to console.error and never propagates", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runAfterCommit(async () => Promise.reject(new Error("x")), {}, outcome)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain("AFTER_COMMIT_FAILED");
  });

  it("a throwing onWarning does not propagate either", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      runAfterCommit(
        () => {
          throw new Error("x");
        },
        {},
        outcome,
        () => {
          throw new Error("warning sink broke");
        },
      ),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
