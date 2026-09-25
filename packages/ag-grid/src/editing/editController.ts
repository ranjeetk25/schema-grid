/**
 * Edit controller: the single write path for edit, paste, fill, undo and redo.
 *
 * submit(changes, source):
 *   1. builds a batch and awaits `beforeCellsChange`: `false` vetoes (row store
 *      untouched), a returned batch replaces the original (its changes and
 *      source), `undefined` means "no change".
 *   2. applies every change optimistically (`rowStore.patchCells`, no version
 *      bump) and marks the cells pending — immediately.
 *   3. sends `dataSource.applyChanges(batch)`. Sends are serialised PER ROW: a
 *      batch waits until every earlier in-flight batch touching any of its rows
 *      has settled, and `baseVersions` are then re-read from the row store at
 *      send time, so quick successive edits never conflict with our own writes.
 *      A base that a `beforeCellsChange` transform changed away from what
 *      `buildBatch` produced is treated as explicit and sent unchanged.
 *   4. applied cells: the row store takes the server's `applied[i].next`
 *      (server-normalised), pending clears as success (dropping old errors).
 *      Row versions become `result.versions[row]` when present, else
 *      `baseVersions[row] + 1` (assumes one bump per applyChanges call), never
 *      lower than the current version.
 *   5. errors: the cell reverts to the EARLIEST `prev` of that cell in the
 *      batch and gets the error message.
 *   6. conflicts: revert likewise, call `onRowStale(rowIds)` once, then
 *      `onConflict(conflict, resolve)` per cell:
 *      - "keepTheirs": write serverValue, version = max(current, serverVersion),
 *        clear the remote-changed flag.
 *      - "overwrite": version = max(current, serverVersion), then re-submit our
 *        value (prev = serverValue) with the same source. Overwrites for the
 *        same row + source resolved in the same tick are coalesced into ONE
 *        re-submit (they go through the full pipeline, incl. beforeCellsChange).
 *      `resolve` acts once; later calls are no-ops. With no `onConflict`
 *      handler the controller resolves "keepTheirs" itself.
 *      A late resolution never clobbers a newer local edit: if a later submit
 *      wrote the cell since the conflicting one, the value is left alone (the
 *      version still moves via max) and an overwrite re-submit is dropped.
 *   7. emits `onCellsChange(result, batch)` (batch = what was sent).
 *   8. resolves to `{ result, batch, vetoed }`.
 *
 * Reverts (5, 6 and the throw path) only touch a cell when this batch is its
 * latest local writer AND the row store still holds this batch's `next` — a
 * newer local edit or a sync patch that landed mid-flight wins.
 *
 * A thrown/rejected `applyChanges` is not rethrown: every cell is reverted
 * (per the rule above), marked with the error message, and the outcome
 * carries a synthetic result whose `errors` list every cell; `onCellsChange`
 * is still emitted.
 *
 * `onRowStale` contract: called once per processed result with the distinct
 * row ids that had conflicts. Resolving a conflict moves the whole row's
 * version to the server's, which can hide other remote cell changes on that
 * row; the host (sync/T28) should refetch those rows in full.
 *
 * Ownership (who may settle a cell) is keyed on an internal submit counter,
 * never on `batch.id`, which a transform or idFactory may repeat.
 */
import type { CompiledFormulas } from "../compile/formulaColumns";
import type {
  CellChange,
  CellConflict,
  ChangeBatch,
  ChangeResult,
  ChangeSource,
  ConflictResolution,
  DataSource,
  GridRow,
  GridSchema,
  SchemaGridEvents,
} from "../internal/core";
import { cellKey, type CellRef, type CellStatusStore } from "../state/cellStatusStore";
import type { RowStore } from "../state/rowStore";
import { conflictToChange, findChangeForConflict } from "./conflicts";

export interface AppliedInfo<Row extends GridRow = GridRow> {
  batch: ChangeBatch;
  result: ChangeResult;
  /** Distinct row ids with at least one applied change, in first-seen order. */
  changedRowIds: string[];
  /** Applied cells (deduped), in order. */
  changedCells: CellRef[];
  /** Formula cells on changed rows whose inputs changed; the grid should refresh them. */
  formulaDependents: CellRef[];
}

export interface EditControllerOptions<Row extends GridRow = GridRow> {
  dataSource: Pick<DataSource<Row>, "applyChanges">;
  schema: GridSchema;
  rowStore: RowStore<Row>;
  cellStatus: CellStatusStore;
  /** Events object, or a getter returning the latest one (e.g. from props). */
  events?: SchemaGridEvents<Row> | (() => SchemaGridEvents<Row> | undefined);
  formulas?: CompiledFormulas<Row>;
  onApplied?(info: AppliedInfo<Row>): void;
  onReverted?(changes: CellChange[]): void;
  /** Rows that had conflicts; the host should refetch them in full (see file header). */
  onRowStale?(rowIds: string[]): void;
  idFactory?(): string;
}

export interface SubmitOutcome {
  result: ChangeResult;
  batch: ChangeBatch;
  vetoed: boolean;
}

export interface EditController<Row extends GridRow = GridRow> {
  submit(changes: CellChange[], source: ChangeSource): Promise<SubmitOutcome>;
  buildBatch(changes: CellChange[], source: ChangeSource): ChangeBatch;
}

function defaultIdFactory(): () => string {
  let counter = 0;
  return () => {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    counter += 1;
    return `batch-${Date.now()}-${counter}`;
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

const emptyResult = (): ChangeResult => ({ applied: [], conflicts: [], errors: [] });

interface CellSpan {
  rowId: string;
  columnId: string;
  /** Earliest prev of this cell in the batch. */
  prev: unknown;
  /** Latest next of this cell in the batch (what the store holds optimistically). */
  next: unknown;
}

interface PendingOverwrite {
  changes: CellChange[];
  waiters: { resolve(): void; reject(e: unknown): void }[];
}

export function createEditController<Row extends GridRow>(opts: EditControllerOptions<Row>): EditController<Row> {
  const { dataSource, rowStore, cellStatus } = opts;
  const nextId = opts.idFactory ?? defaultIdFactory();
  let ticketCounter = 0;
  /** cellKey → ticket of the latest submit that wrote the cell and has not settled. */
  const owners = new Map<string, number>();
  /** cellKey → ticket of the latest submit that ever wrote the cell (for late conflict resolutions). */
  const lastWrite = new Map<string, number>();
  /** rowId → promise settling when the latest in-flight batch touching the row settles. */
  const rowTails = new Map<string, Promise<void>>();
  /** `${source}\0${rowId}` → overwrites collected in the current tick. */
  const overwriteQueue = new Map<string, PendingOverwrite>();

  const keyOf = (columnId: string): string => opts.schema.columns.find((c) => c.id === columnId)?.key ?? columnId;
  const getEvents = (): SchemaGridEvents<Row> | undefined =>
    typeof opts.events === "function" ? opts.events() : opts.events;
  const ref = (c: { rowId: string; columnId: string }): CellRef => ({ rowId: c.rowId, columnId: c.columnId });
  const kOf = (c: { rowId: string; columnId: string }): string => cellKey(c.rowId, c.columnId);
  const cellValue = (rowId: string, columnId: string): unknown => rowStore.getRow(rowId)?.cells[keyOf(columnId)];
  const bumpVersion = (rowId: string, to: number): void => {
    const current = rowStore.getVersion(rowId);
    if (current === undefined || to > current) rowStore.patchCells(rowId, {}, to);
  };

  const baseVersionsFor = (changes: readonly CellChange[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const c of changes) {
      if (c.rowId in out) continue;
      const v = rowStore.getVersion(c.rowId);
      if (v !== undefined) out[c.rowId] = v;
    }
    return out;
  };

  const buildBatch = (changes: CellChange[], source: ChangeSource): ChangeBatch => ({
    id: nextId(),
    changes,
    baseVersions: baseVersionsFor(changes),
    source,
  });

  const spansOf = (changes: readonly CellChange[]): Map<string, CellSpan> => {
    const spans = new Map<string, CellSpan>();
    for (const c of changes) {
      const k = kOf(c);
      const span = spans.get(k);
      if (span) span.next = c.next;
      else spans.set(k, { rowId: c.rowId, columnId: c.columnId, prev: c.prev, next: c.next });
    }
    return spans;
  };

  /**
   * Reverts the given cells (by key) owned by `ticket` whose store value is
   * still our optimistic `next`; clears pending on every owned one.
   */
  const revertCells = (ticket: number, keys: Iterable<string>, spans: Map<string, CellSpan>, changes: readonly CellChange[]): CellChange[] => {
    const clear: CellRef[] = [];
    const revertedKeys = new Set<string>();
    for (const k of keys) {
      const span = spans.get(k);
      if (!span || owners.get(k) !== ticket) continue;
      clear.push(ref(span));
      if (deepEqual(cellValue(span.rowId, span.columnId), span.next)) {
        rowStore.patchCells(span.rowId, { [keyOf(span.columnId)]: span.prev });
        revertedKeys.add(k);
      }
    }
    if (clear.length > 0) cellStatus.clearPending(clear);
    return changes.filter((c) => revertedKeys.has(kOf(c)));
  };

  const release = (ticket: number, spans: Map<string, CellSpan>): void => {
    for (const k of spans.keys()) if (owners.get(k) === ticket) owners.delete(k);
  };

  const flushOverwrites = async (queueKey: string, source: ChangeSource): Promise<void> => {
    const pending = overwriteQueue.get(queueKey);
    overwriteQueue.delete(queueKey);
    if (!pending) return;
    try {
      await submit(pending.changes, source);
      for (const w of pending.waiters) w.resolve();
    } catch (e) {
      for (const w of pending.waiters) w.reject(e);
    }
  };

  const queueOverwrite = (change: CellChange, source: ChangeSource): Promise<void> => {
    const queueKey = `${source}\u0000${change.rowId}`;
    let pending = overwriteQueue.get(queueKey);
    if (!pending) {
      pending = { changes: [], waiters: [] };
      overwriteQueue.set(queueKey, pending);
      queueMicrotask(() => void flushOverwrites(queueKey, source));
    }
    const target = pending;
    target.changes.push(change);
    return new Promise<void>((resolve, reject) => target.waiters.push({ resolve, reject }));
  };

  const makeResolver = (conflict: CellConflict, batch: ChangeBatch, ticket: number) => {
    let done = false;
    return async (resolution: ConflictResolution): Promise<void> => {
      if (done) return;
      done = true;
      const k = kOf(conflict);
      const newerLocal = (lastWrite.get(k) ?? ticket) > ticket;
      bumpVersion(conflict.rowId, conflict.serverVersion);
      if (resolution === "keepTheirs") {
        if (!newerLocal) rowStore.patchCells(conflict.rowId, { [keyOf(conflict.columnId)]: conflict.serverValue });
        cellStatus.clearRemoteChanged(ref(conflict));
        return;
      }
      if (newerLocal) return;
      const ours = findChangeForConflict(batch.changes, conflict);
      if (!ours) return;
      await queueOverwrite(conflictToChange(conflict, ours), batch.source);
    };
  };

  const collectApplied = (batch: ChangeBatch, result: ChangeResult): AppliedInfo<Row> => {
    const changedRowIds: string[] = [];
    const changedCells: CellRef[] = [];
    const formulaDependents: CellRef[] = [];
    const seenRows = new Set<string>();
    const seenCells = new Set<string>();
    const seenDeps = new Set<string>();
    for (const c of result.applied) {
      if (!seenRows.has(c.rowId)) {
        seenRows.add(c.rowId);
        changedRowIds.push(c.rowId);
      }
      const k = kOf(c);
      if (!seenCells.has(k)) {
        seenCells.add(k);
        changedCells.push(ref(c));
      }
      for (const depId of opts.formulas?.dependents.get(keyOf(c.columnId)) ?? []) {
        const dk = cellKey(c.rowId, depId);
        if (seenDeps.has(dk)) continue;
        seenDeps.add(dk);
        formulaDependents.push({ rowId: c.rowId, columnId: depId });
      }
    }
    return { batch, result, changedRowIds, changedCells, formulaDependents };
  };

  async function submit(changes: CellChange[], source: ChangeSource): Promise<SubmitOutcome> {
    const built = buildBatch(changes, source);
    let batch = built;

    // 1. Veto / transform.
    const before = getEvents()?.beforeCellsChange;
    if (before) {
      const decided = await before(built);
      if (decided === false) return { result: emptyResult(), batch: built, vetoed: true };
      if (decided) batch = decided;
    }

    // 2. Optimistic apply (immediate).
    const ticket = ++ticketCounter;
    const spans = spansOf(batch.changes);
    for (const c of batch.changes) rowStore.patchCells(c.rowId, { [keyOf(c.columnId)]: c.next });
    for (const k of spans.keys()) {
      owners.set(k, ticket);
      lastWrite.set(k, ticket);
    }
    if (spans.size > 0) cellStatus.setPending([...spans.values()].map(ref));

    // Per-row send serialisation.
    const rows = [...new Set(batch.changes.map((c) => c.rowId))];
    const waitFor = rows.map((r) => rowTails.get(r)).filter((p): p is Promise<void> => p !== undefined);
    let settle!: () => void;
    const settled = new Promise<void>((r) => {
      settle = r;
    });
    for (const r of rows) rowTails.set(r, settled);
    const finish = (): void => {
      for (const r of rows) if (rowTails.get(r) === settled) rowTails.delete(r);
      settle();
    };

    let result: ChangeResult;
    try {
      if (waitFor.length > 0) await Promise.all(waitFor);

      // Rebase implicit bases at send time.
      const fresh = baseVersionsFor(batch.changes);
      const baseVersions: Record<string, number> = { ...batch.baseVersions };
      for (const r of rows) {
        const explicit = r in batch.baseVersions && batch.baseVersions[r] !== built.baseVersions[r];
        const v = fresh[r];
        if (!explicit && v !== undefined) baseVersions[r] = v;
      }
      batch = { ...batch, baseVersions };

      // 3. Server write.
      try {
        result = await dataSource.applyChanges(batch);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        result = { applied: [], conflicts: [], errors: [...spans.values()].map((s) => ({ ...ref(s), message })) };
        const reverted = revertCells(ticket, spans.keys(), spans, batch.changes);
        for (const s of spans.values()) cellStatus.setError(ref(s), message);
        release(ticket, spans);
        finish();
        if (reverted.length > 0) opts.onReverted?.(reverted);
        getEvents()?.onCellsChange?.(result, batch);
        return { result, batch, vetoed: false };
      }

      // 4. Applied.
      const appliedOwned: CellRef[] = [];
      for (const c of result.applied) {
        const k = kOf(c);
        if (owners.get(k) !== ticket) continue;
        const span = spans.get(k);
        if (span && !deepEqual(span.next, c.next) && deepEqual(cellValue(c.rowId, c.columnId), span.next)) {
          rowStore.patchCells(c.rowId, { [keyOf(c.columnId)]: c.next });
        }
        appliedOwned.push(ref(c));
      }
      if (appliedOwned.length > 0) cellStatus.clearPending(appliedOwned, { success: true });
      for (const rowId of new Set(result.applied.map((c) => c.rowId))) {
        const serverVersion = result.versions?.[rowId];
        const base = batch.baseVersions[rowId];
        const target = serverVersion ?? (base !== undefined ? base + 1 : undefined);
        if (target !== undefined) bumpVersion(rowId, target);
      }

      // 5. Errors.
      const revertedErrors = revertCells(ticket, result.errors.map(kOf), spans, batch.changes);
      for (const err of result.errors) cellStatus.setError(ref(err), err.message);

      // 6a. Conflicts: revert first.
      const revertedConflicts = revertCells(ticket, result.conflicts.map(kOf), spans, batch.changes);

      // Cells the server did not mention: settle pending, keep the value.
      const mentioned = new Set([...result.applied, ...result.errors, ...result.conflicts].map(kOf));
      const unmentioned = [...spans.entries()].filter(([k]) => !mentioned.has(k) && owners.get(k) === ticket);
      if (unmentioned.length > 0) cellStatus.clearPending(unmentioned.map(([, s]) => ref(s)));

      release(ticket, spans);
      finish();

      const reverted = [...revertedErrors, ...revertedConflicts];
      if (reverted.length > 0) opts.onReverted?.(reverted);
      if (result.applied.length > 0) opts.onApplied?.(collectApplied(batch, result));
    } catch (e) {
      finish();
      throw e;
    }

    // 6b. Conflicts: hand off.
    const events = getEvents();
    if (result.conflicts.length > 0) opts.onRowStale?.([...new Set(result.conflicts.map((c) => c.rowId))]);
    const defaults: Promise<void>[] = [];
    for (const conflict of result.conflicts) {
      const resolve = makeResolver(conflict, batch, ticket);
      if (events?.onConflict) events.onConflict(conflict, resolve);
      else defaults.push(resolve("keepTheirs"));
    }
    await Promise.all(defaults);

    // 7. Notify.
    events?.onCellsChange?.(result, batch);

    // 8.
    return { result, batch, vetoed: false };
  }

  return { submit, buildBatch };
}
