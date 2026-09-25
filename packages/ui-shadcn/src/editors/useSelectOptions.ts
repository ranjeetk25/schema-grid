import { useEffect, useMemo, useState } from "react";
import type { ColumnDef, DataSource, Option } from "../internal/core-contracts";
import { getSelectOptions } from "../internal/options";

/**
 * Options for a select-family editor. Static options follow `config` live
 * (e.g. a column builder adding options); with `config.dynamic` they are
 * fetched once from `dataSource.getOptions(column.id)` (static until then).
 */
export function useSelectOptions(config: unknown, dataSource: DataSource | undefined, column: ColumnDef): Option[] {
  const configOptions = useMemo(() => getSelectOptions(config), [config]);
  const [fetched, setFetched] = useState<Option[] | null>(null);
  const dynamic = !!config && typeof config === "object" && (config as { dynamic?: unknown }).dynamic === true;

  useEffect(() => {
    if (!dynamic || !dataSource?.getOptions) return;
    let cancelled = false;
    dataSource.getOptions(column.id).then(
      (opts) => {
        if (!cancelled) setFetched(opts);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [dynamic, dataSource, column.id]);

  return dynamic ? (fetched ?? configOptions) : configOptions;
}

/** Case-insensitive substring match on the label (Mantine combobox semantics). */
export function filterOptions(options: readonly Option[], search: string): Option[] {
  const q = search.trim().toLowerCase();
  return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : [...options];
}

/** cmdk item values are namespaced so no option id can collide with an internal item. */
export const optionItemValue = (id: string) => `o:${id}`;
