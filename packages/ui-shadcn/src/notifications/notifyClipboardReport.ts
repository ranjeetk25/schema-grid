import type { ClipboardReport } from "../internal/grid-contracts";

export interface ClipboardReportMessage {
  title: string;
  message: string;
  color: "green" | "yellow" | "red" | "gray";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Pure: "Pasted 40 cells, 3 skipped (2 invalid, 1 read-only), 1 conflict" +
 * a severity colour. Conflicts are cells the server reported as changed by
 * someone else; they are resolved through `events.onConflict`.
 */
export function formatClipboardReport(report: ClipboardReport): ClipboardReportMessage {
  const invalid = report.errors.length;
  const readOnly = report.skippedReadOnly;
  const skipped = invalid + readOnly;
  let message = `Pasted ${plural(report.pastedCells, "cell")}`;
  if (skipped > 0) {
    const parts: string[] = [];
    if (invalid > 0) parts.push(`${invalid} invalid`);
    if (readOnly > 0) parts.push(`${readOnly} read-only`);
    message += `, ${skipped} skipped (${parts.join(", ")})`;
  }
  if (report.conflicts > 0) message += `, ${plural(report.conflicts, "conflict")}`;
  if (report.pastedCells === 0 && skipped === 0 && report.conflicts === 0) return { title: "Nothing pasted", message, color: "gray" };
  if (report.pastedCells === 0) return { title: "Paste failed", message, color: "red" };
  if (skipped > 0 || report.conflicts > 0) return { title: "Paste partially applied", message, color: "yellow" };
  return { title: "Paste complete", message, color: "green" };
}

type ToastFn = (title: string, data?: { description?: string }) => unknown;
type SonnerToast = ToastFn & { success?: ToastFn; warning?: ToastFn; error?: ToastFn };

interface SonnerModule {
  toast?: SonnerToast;
  default?: { toast?: SonnerToast };
}

export interface NotifyClipboardReportOptions {
  /** Injectable module loader; defaults to a lazy `import("sonner")`. */
  loader?: () => Promise<unknown>;
}

/**
 * Literal specifier so bundlers resolve (and code-split) the optional peer;
 * a non-literal one is left unresolved and always fails in a bundled app.
 * A missing package rejects here and `notifyClipboardReport` answers
 * "unavailable".
 */
const defaultLoader = (): Promise<unknown> => import("sonner");

function pick(toast: SonnerToast, color: ClipboardReportMessage["color"]): ToastFn {
  const helper = color === "green" ? toast.success : color === "yellow" ? toast.warning : color === "red" ? toast.error : undefined;
  return typeof helper === "function" ? helper.bind(toast) : toast;
}

/**
 * Shows a toast for a paste report via the optional `sonner` peer
 * (`<Toaster />` must be mounted by the app): success / warning / error by
 * severity, the counts as the description. Never throws: resolves
 * "unavailable" when the package is missing or the toast call fails.
 */
export async function notifyClipboardReport(
  report: ClipboardReport,
  options: NotifyClipboardReportOptions = {},
): Promise<"shown" | "unavailable"> {
  try {
    const mod = (await (options.loader ?? defaultLoader)()) as SonnerModule | null;
    const toast = mod?.toast ?? mod?.default?.toast;
    if (typeof toast !== "function") return "unavailable";
    const { title, message, color } = formatClipboardReport(report);
    pick(toast, color)(title, { description: message });
    return "shown";
  } catch {
    return "unavailable";
  }
}
