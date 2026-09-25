import { z } from "zod";
import type { FieldType } from "../types";
import { makeContactType } from "./contact-shared";

// biome-ignore lint/complexity/noBannedTypes: empty config
export type UrlConfig = {};

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

function toUrl(text: string): string | null {
  if (/\s/.test(text)) return null;
  const candidate = SCHEME_RE.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname) return null;
    // Require a dotted host unless it's localhost or an IPv6 literal.
    if (!url.hostname.includes(".") && url.hostname !== "localhost" && !url.hostname.startsWith("[")) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export const urlFieldType: FieldType<string, UrlConfig> = makeContactType<UrlConfig>({
  id: "url",
  label: "URL",
  configSchema: z.object({}),
  defaultConfig: {},
  normalize: (text) => toUrl(text),
  isValid: (v) => SCHEME_RE.test(v) && toUrl(v) === v,
  errorMessage: "Invalid URL",
});
