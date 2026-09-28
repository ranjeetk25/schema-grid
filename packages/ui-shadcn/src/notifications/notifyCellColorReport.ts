import type { CellColorReport } from "../internal/grid-contracts";
import { cellColorLabel } from "../theme/cellColors";
import type { ClipboardReportMessage } from "./notifyClipboardReport";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Pure (v0.4): "Colored 2 cells, 3 skipped (2 read-only, 1 rejected)" + a
 * severity colour. `skipped` are cells this user can't paint (never sent),
 * `rejected` the ones the source refused (rolled back).
 */
export function formatCellColorReport(report: CellColorReport): ClipboardReportMessage {
  const clearing = report.color === null;
  const missed = report.skipped + report.rejected;
  let message = `${clearing ? "Cleared" : "Colored"} ${plural(report.applied, "cell")}`;
  if (missed > 0) {
    const parts: string[] = [];
    if (report.skipped > 0) parts.push(`${report.skipped} read-only`);
    if (report.rejected > 0) parts.push(`${report.rejected} rejected`);
    message += `, ${missed} skipped (${parts.join(", ")})`;
  }
  if (report.applied === 0) return { title: clearing ? "Nothing cleared" : "Nothing colored", message, color: "red" };
  if (missed > 0) return { title: "Color partially applied", message, color: "yellow" };
  const title = report.color === null ? "Color cleared" : `Colored ${cellColorLabel(report.color).toLowerCase()}`;
  return { title, message, color: "green" };
}

/** The status-bar line for a paint ("Colored 4 cells, 1 skipped (1 read-only)"). */
export function cellColorSummary(report: CellColorReport): string {
  return formatCellColorReport(report).message;
}

type ToastFn = (title: string, data?: { description?: string }) => unknown;
type SonnerToast = ToastFn & { success?: ToastFn; warning?: ToastFn; error?: ToastFn };

interface SonnerModule {
  toast?: SonnerToast;
  default?: { toast?: SonnerToast };
}

export interface NotifyCellColorReportOptions {
  /** Injectable module loader; defaults to a lazy `import("sonner")`. */
  loader?: () => Promise<unknown>;
}

/** Literal specifier so bundlers resolve (and code-split) the optional peer (see notifyClipboardReport). */
const defaultLoader = (): Promise<unknown> => import("sonner");

/**
 * Shows a toast for a paint report via the optional `sonner` peer, like
 * `notifyClipboardReport` (the workbench calls it when cells were skipped or
 * rejected). Never throws: resolves "unavailable" when the package is
 * missing or the toast call fails.
 */
export async function notifyCellColorReport(
  report: CellColorReport,
  options: NotifyCellColorReportOptions = {},
): Promise<"shown" | "unavailable"> {
  try {
    const mod = (await (options.loader ?? defaultLoader)()) as SonnerModule | null;
    const toast = mod?.toast ?? mod?.default?.toast;
    if (typeof toast !== "function") return "unavailable";
    const { title, message, color } = formatCellColorReport(report);
    const helper = color === "green" ? toast.success : color === "yellow" ? toast.warning : color === "red" ? toast.error : undefined;
    (typeof helper === "function" ? helper.bind(toast) : toast)(title, { description: message });
    return "shown";
  } catch {
    return "unavailable";
  }
}
