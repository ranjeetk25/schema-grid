/** A select-like option normalised for column filters: `id` is the stored value. */
export interface ColumnFilterOption {
  id: string;
  label: string;
  color?: string;
  avatarUrl?: string;
}

/** Normalises `{ id | value, label?, color?, avatarUrl? }` objects (core `Option`, older `value` shapes, users). */
export function toColumnFilterOptions(list: readonly unknown[]): ColumnFilterOption[] {
  const out: ColumnFilterOption[] = [];
  const seen = new Set<string>();
  for (const o of list) {
    if (typeof o !== "object" || o === null) continue;
    const raw = o as { id?: unknown; value?: unknown; label?: unknown; color?: unknown; avatarUrl?: unknown };
    const id = raw.id ?? raw.value;
    // Empty / repeated ids would crash Mantine's Select ("duplicate options").
    if (id === undefined || id === null || String(id) === "" || seen.has(String(id))) continue;
    seen.add(String(id));
    out.push({
      id: String(id),
      label: raw.label === undefined || raw.label === null ? String(id) : String(raw.label),
      ...(typeof raw.color === "string" && raw.color ? { color: raw.color } : {}),
      ...(typeof raw.avatarUrl === "string" && raw.avatarUrl ? { avatarUrl: raw.avatarUrl } : {}),
    });
  }
  return out;
}

/** Static options from a select-like column config (empty when there are none). */
export function filterOptions(config: unknown): ColumnFilterOption[] {
  const options = (config as { options?: unknown } | null | undefined)?.options;
  return Array.isArray(options) ? toColumnFilterOptions(options) : [];
}
