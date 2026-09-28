import type { CellColorReport } from "../internal/color-contracts";
import { CELL_COLOR_TOKENS } from "../internal/color-contracts";
import type { ClipboardReportMessage } from "./notifyClipboardReport";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Pure: "Colored 3 cells red, 1 skipped (read-only), 1 not saved" + a
 * severity colour, or null when every requested cell was painted (nothing
 * worth a toast). `skipped` cells were not paintable for this user (never
 * sent); `rejected` ones the data source refused (rolled back).
 */
export function formatCellColorReport(
  report: CellColorReport,
): ClipboardReportMessage | null {
  const { applied, skipped, rejected } = report;
  if (skipped === 0 && rejected === 0) return null;
  let message =
    report.color === null
      ? `Cleared the color of ${plural(applied, "cell")}`
      : `Colored ${plural(applied, "cell")} ${CELL_COLOR_TOKENS[report.color].label.toLowerCase()}`;
  if (skipped > 0) message += `, ${skipped} skipped (read-only)`;
  if (rejected > 0) message += `, ${rejected} not saved`;
  if (applied === 0) return { title: "Nothing colored", message, color: "red" };
  return { title: "Color partially applied", message, color: "yellow" };
}

interface NotificationsModule {
  notifications?: {
    show(payload: { title: string; message: string; color: string }): unknown;
  };
}

export interface NotifyCellColorReportOptions {
  /** Injectable module loader; defaults to a lazy `import("@mantine/notifications")`. */
  loader?: () => Promise<unknown>;
}

/** Literal specifier so bundlers resolve (and code-split) the optional peer (see `notifyClipboardReport`). */
const defaultLoader = (): Promise<unknown> => import("@mantine/notifications");

/**
 * v0.4: a toast for a paint that skipped or lost cells, via the optional
 * `@mantine/notifications` peer (`<Notifications />` must be mounted).
 * Resolves "nothing" when every cell was painted (no toast), "unavailable"
 * when the package is missing. Never throws.
 */
export async function notifyCellColorReport(
  report: CellColorReport,
  options: NotifyCellColorReportOptions = {},
): Promise<"shown" | "nothing" | "unavailable"> {
  const message = formatCellColorReport(report);
  if (!message) return "nothing";
  try {
    const mod = (await (
      options.loader ?? defaultLoader
    )()) as NotificationsModule | null;
    const show = mod?.notifications?.show;
    if (typeof show !== "function") return "unavailable";
    show.call(mod?.notifications, message);
    return "shown";
  } catch {
    return "unavailable";
  }
}
