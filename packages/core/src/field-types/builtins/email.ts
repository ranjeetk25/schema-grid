import { z } from "zod";
import type { FieldType } from "../types";
import { makeContactType } from "./contact-shared";

// biome-ignore lint/complexity/noBannedTypes: empty config
export type EmailConfig = {};

const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function normalizeEmail(text: string): string | null {
  const at = text.lastIndexOf("@");
  if (at <= 0) return null;
  const value = `${text.slice(0, at)}@${text.slice(at + 1).toLowerCase()}`;
  return EMAIL_RE.test(value) ? value : null;
}

export const emailFieldType: FieldType<string, EmailConfig> = makeContactType<EmailConfig>({
  id: "email",
  label: "Email",
  configSchema: z.object({}),
  defaultConfig: {},
  normalize: normalizeEmail,
  isValid: (v) => EMAIL_RE.test(v),
  errorMessage: "Invalid email address",
});
