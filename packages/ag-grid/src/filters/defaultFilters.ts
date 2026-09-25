import type { UiFilterEntry } from "../compile/uiRegistry";
import type { FieldTypeId } from "../internal/core";

/**
 * Per-type filter/floating-filter registrations, filled in by T19. Left as an
 * empty map here so `createDefaultUiRegistry` (T5) has something to merge
 * without a hard dependency on the filter components themselves.
 */
export const DEFAULT_FILTERS: Partial<Record<FieldTypeId, UiFilterEntry>> = {};
