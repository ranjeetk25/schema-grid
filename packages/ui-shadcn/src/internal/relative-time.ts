const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

const toMs = (v: Date | string | number) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/**
 * "5 minutes ago", "yesterday", "in 2 hours" — `Intl.RelativeTimeFormat`
 * with the largest unit that fits, so no global dayjs plugin is needed.
 */
export function formatRelativeTime(from: Date | string | number, now: Date | string | number = new Date(), locale = "en"): string {
  const diffSec = Math.round((toMs(from) - toMs(now)) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === "second") {
      return rtf.format(Math.trunc(diffSec / secs), unit);
    }
  }
  return rtf.format(0, "second");
}
