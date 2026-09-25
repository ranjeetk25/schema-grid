import type { UiEditorEntry } from "../compile/uiRegistry";
import type { FieldTypeId } from "../internal/core";

/**
 * Per-type editor registrations, filled in by T17. Left as an empty map here
 * so `createDefaultUiRegistry` (T5) has something to merge without a hard
 * dependency on the editor components themselves.
 */
export const DEFAULT_EDITORS: Partial<Record<FieldTypeId, UiEditorEntry>> = {};
