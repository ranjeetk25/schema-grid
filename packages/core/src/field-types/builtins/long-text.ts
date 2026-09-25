import type { FieldType } from "../types";
import { makeTextLikeType, type TextLikeConfig } from "./text-shared";

export type LongTextConfig = TextLikeConfig;

/** Multi-line text. Newlines are kept. */
export const longTextFieldType: FieldType<string, LongTextConfig> = makeTextLikeType({
  id: "longText",
  label: "Long text",
  normalize: (s) => s.replace(/\r\n/g, "\n"),
});
