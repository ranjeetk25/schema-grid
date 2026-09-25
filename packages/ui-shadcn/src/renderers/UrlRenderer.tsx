import type { UiRendererProps } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** A link for http(s) URLs, opened in a new tab; plain text for anything else (e.g. `javascript:`). */
export function UrlRenderer({ value }: UiRendererProps<string, unknown>) {
  if (value === null || value === undefined || value === "") return null;
  if (!isHttpUrl(value)) return <span className={cn(SG_ROOT, "sg:block sg:cursor-default sg:truncate")}>{value}</span>;
  return (
    <a
      href={value}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        SG_ROOT,
        "sg:block sg:truncate sg:text-foreground sg:underline sg:decoration-input-hover sg:underline-offset-[3px] sg:outline-none",
        "sg:transition-colors sg:hover:decoration-foreground sg:focus-visible:rounded-xs sg:focus-visible:ring-2 sg:focus-visible:ring-ring",
      )}
    >
      {value}
    </a>
  );
}
