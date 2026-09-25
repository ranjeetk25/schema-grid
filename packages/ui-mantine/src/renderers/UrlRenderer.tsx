import { Anchor } from "@mantine/core";
import type { UiRendererProps } from "../internal/grid-contracts";
import { CellBox } from "./CellBox";

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
  if (!isHttpUrl(value)) {
    return (
      <CellBox>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
      </CellBox>
    );
  }
  return (
    <CellBox>
      <Anchor href={value} target="_blank" rel="noopener noreferrer" size="sm" underline="hover" truncate>
        {value}
      </Anchor>
    </CellBox>
  );
}
