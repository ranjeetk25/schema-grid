/**
 * Announces the non-success outcomes of an edit-controller submit (T30).
 *
 * `withEditAnnouncements(controller, options)` returns the same controller
 * with `submit` wrapped; after each submit settles it announces, ASSERTIVELY:
 *   - a veto (`beforeCellsChange` returned false) → "Edit cancelled"
 *   - conflicts → "Conflict on {column}, row {id}" (one) / "Conflicts on N cells"
 *   - errors    → "Edit rejected on {column}: {reason}" (one) / "N edits rejected"
 * Conflicts win over errors when a batch has both (one assertive message per
 * batch; the region would otherwise overwrite itself).
 *
 * Silently rejected changes (v0.3, `outcome.rejected`) are never assertive:
 * when a submit has nothing else to say, ONE polite "N changes not saved"
 * (`notSavedMessage`) is announced instead; an assertive message wins.
 *
 * Success ("Saved N cells") is announced politely by `<SchemaGrid>` through
 * the controller's `onApplied`, not here. `"paste"` submits are skipped:
 * `useClipboard` announces a paste summary that already counts conflicts and
 * errors. A rejected submit (throw) is left to the caller.
 *
 * Column labels come from `getSchema()` (the column's `label`, else its id).
 */
import type { EditController, SubmitOutcome } from "../editing/editController";
import type { ChangeSource, GridRow, GridSchema } from "../internal/core";
import {
  conflictMessage,
  conflictsMessage,
  EDIT_CANCELLED,
  editRejectedMessage,
  editsRejectedMessage,
  notSavedMessage,
  type Politeness,
} from "./announcer";

export interface EditAnnouncementOptions {
  getSchema(): GridSchema;
  announce(message: string, politeness?: Politeness): void;
}

/** The assertive message for a settled submit, or null when there is nothing to announce. */
export function editOutcomeMessage(outcome: SubmitOutcome, source: ChangeSource, schema: GridSchema): string | null {
  if (source === "paste") return null;
  if (outcome.vetoed) return EDIT_CANCELLED;
  const label = (columnId: string): string => {
    const column = schema.columns.find((c) => c.id === columnId);
    return column?.label || columnId;
  };
  const { conflicts, errors } = outcome.result;
  const firstConflict = conflicts[0];
  if (firstConflict) {
    return conflicts.length === 1
      ? conflictMessage(label(firstConflict.columnId), firstConflict.rowId)
      : conflictsMessage(conflicts.length);
  }
  const firstError = errors[0];
  if (firstError) {
    return errors.length === 1
      ? editRejectedMessage(label(firstError.columnId), firstError.message)
      : editsRejectedMessage(errors.length);
  }
  return null;
}

export function withEditAnnouncements<Row extends GridRow>(
  controller: EditController<Row>,
  options: EditAnnouncementOptions,
): EditController<Row> {
  return {
    ...controller,
    async submit(changes, source) {
      const outcome = await controller.submit(changes, source);
      const message = editOutcomeMessage(outcome, source, options.getSchema());
      if (message) options.announce(message, "assertive");
      else if (source !== "paste" && source !== "fill" && (outcome.rejected?.length ?? 0) > 0) {
        options.announce(notSavedMessage(outcome.rejected?.length ?? 0), "polite");
      }
      return outcome;
    },
  };
}
