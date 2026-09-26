/**
 * Export file naming (v0.3). Framework-free (copied verbatim by ui-shadcn).
 * Default: `${gridId ?? schemaId}-${viewName ?? "all"}-${YYYY-MM-DD}.${format}`, slugified.
 */
import type { GridSchema, ViewDef } from "@ranjeetk25/schema-grid-core";

export type ExportFileFormat = "csv" | "xlsx";

/** What an `exportFileName` function receives. */
export interface ExportFileNameContext {
  gridId: string;
  schema: GridSchema;
  /** The active saved view, or null (quick export outside any view). */
  view: ViewDef | null;
  format: ExportFileFormat;
  date: Date;
}

export type ExportFileNameOption = string | ((ctx: ExportFileNameContext) => string);

/** "Unpaid, called yesterday" → "unpaid-called-yesterday". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function defaultExportFileName(input: {
  gridId?: string | null;
  schemaId: string;
  viewName?: string | null;
  format: ExportFileFormat;
  now?: Date;
}): string {
  const base = slugify(input.gridId || input.schemaId) || "export";
  const view = slugify(input.viewName ?? "") || "all";
  return `${base}-${view}-${isoDate(input.now ?? new Date())}.${input.format}`;
}

/** Appends `.${format}` unless the name already ends with it (case-insensitive). */
export function withExtension(name: string, format: ExportFileFormat): string {
  return name.toLowerCase().endsWith(`.${format}`) ? name : `${name}.${format}`;
}

/** Resolves the `exportFileName` prop (string verbatim, function called) or the default. */
export function resolveExportFileName(option: ExportFileNameOption | undefined, ctx: ExportFileNameContext): string {
  if (typeof option === "string") return withExtension(option, ctx.format);
  if (typeof option === "function") return withExtension(option(ctx), ctx.format);
  return defaultExportFileName({
    gridId: ctx.gridId,
    schemaId: ctx.schema.id,
    viewName: ctx.view?.name ?? null,
    format: ctx.format,
    now: ctx.date,
  });
}
