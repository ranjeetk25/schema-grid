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

interface NotificationsModule {
  notifications?: { show(payload: { title: string; message: string; color: string }): unknown };
}

export interface NotifyClipboardReportOptions {
  /** Injectable module loader; defaults to a lazy `import("@mantine/notifications")`. */
  loader?: () => Promise<unknown>;
}

// Non-static specifier so bundlers do not hard-require the optional peer.
const NOTIFICATIONS_MODULE = ["@mantine", "notifications"].join("/");
const defaultLoader = () => import(/* @vite-ignore */ /* webpackIgnore: true */ NOTIFICATIONS_MODULE) as Promise<unknown>;

/**
 * Shows a toast for a paste report via the optional `@mantine/notifications`
 * peer. `<Notifications />` must be mounted by the app. Never throws: resolves
 * "unavailable" when the package is missing.
 */
export async function notifyClipboardReport(
  report: ClipboardReport,
  options: NotifyClipboardReportOptions = {},
): Promise<"shown" | "unavailable"> {
  try {
    const mod = (await (options.loader ?? defaultLoader)()) as NotificationsModule | null;
    const show = mod?.notifications?.show;
    if (typeof show !== "function") return "unavailable";
    show.call(mod?.notifications, formatClipboardReport(report));
    return "shown";
  } catch {
    return "unavailable";
  }
}
