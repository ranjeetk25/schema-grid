import type { FieldType } from "../types";
import { makeTextLikeType, type TextLikeConfig } from "./text-shared";

export type TextConfig = TextLikeConfig;

/** Single-line text. Newlines are collapsed to spaces on parse. */
export const textFieldType: FieldType<string, TextConfig> = makeTextLikeType({
  id: "text",
  label: "Text",
  normalize: (s) => s.replace(/\s*\r?\n\s*/g, " "),
});
