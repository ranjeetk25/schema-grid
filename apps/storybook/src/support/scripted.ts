/**
 * Scripted "other user" helpers over an in-memory data source: a remote edit
 * applied behind the grid's back (so the grid's base version goes stale), and
 * a data source wrapper that labels resulting conflicts with the remote actor.
 */
import type {
  ActorRef,
  ChangeResult,
  DataSource,
  GridRow,
} from "@masai/schema-grid-core";
import type { InMemoryDataSource } from "@masai/schema-grid-core/memory";

export const REMOTE_ACTOR: ActorRef = { id: "u9", name: "Priya (remote)" };

/** Writes `cells` to `rowId` as if another user did it (bumps the row version). */
export async function remoteEdit(
  memory: InMemoryDataSource,
  rowId: string,
  changes: Record<string, unknown>,
): Promise<ChangeResult> {
  const row = memory.snapshot().find((r) => r.id === rowId);
  if (!row) throw new Error(`No row ${rowId}`);
  const schema = memory.getSchema();
  return memory.applyChanges({
    id: `remote_${Date.now().toString(36)}`,
    baseVersions: { [rowId]: row.version },
    source: "edit",
    changes: Object.entries(changes).map(([key, next]) => {
      const column = schema.columns.find((c) => c.key === key);
      if (!column) throw new Error(`No column ${key}`);
      return { rowId, columnId: column.id, prev: row.cells[key], next };
    }),
  });
}

/** Rewrites `updatedBy` on conflicts/feed rows touched by `remoteEdit` to REMOTE_ACTOR. */
export function withRemoteActor(
  ds: DataSource<GridRow>,
  remoteRowIds: Set<string>,
): DataSource<GridRow> {
  return {
    ...ds,
    fetch: (q) => ds.fetch(q),
    async applyChanges(batch) {
      const result = await ds.applyChanges(batch);
      return {
        ...result,
        conflicts: result.conflicts.map((c) =>
          remoteRowIds.has(c.rowId) ? { ...c, updatedBy: REMOTE_ACTOR } : c,
        ),
      };
    },
    ...(ds.getChanges
      ? {
          async getChanges(since: string) {
            const entry = await (
              ds.getChanges as NonNullable<DataSource<GridRow>["getChanges"]>
            )(since);
            return {
              ...entry,
              rows: entry.rows.map((r) =>
                remoteRowIds.has(r.id) ? { ...r, updatedBy: REMOTE_ACTOR } : r,
              ),
            };
          },
        }
      : {}),
  };
}
