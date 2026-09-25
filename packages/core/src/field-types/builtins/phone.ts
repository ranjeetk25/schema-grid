import { z } from "zod";
import type { ZodType } from "zod";
import type { FieldType } from "../types";
import { makeContactType } from "./contact-shared";

export interface PhoneConfig {
  /** E.g. "+91". Applied when the input has no leading "+". */
  defaultCountryCode: string;
}

const STORED_RE = /^\+\d{7,15}$/;

const phoneConfigSchema: ZodType<PhoneConfig> = z.object({
  defaultCountryCode: z.string().refine((s) => /^\+\d{1,4}$/.test(s), "Invalid country code"),
});

function normalizePhone(text: string, config: PhoneConfig): string | null {
  const stripped = text.replace(/[\s\-().]/g, "");
  const hasPlus = stripped.startsWith("+");
  const digits = hasPlus ? stripped.slice(1) : stripped;
  if (!/^\d{7,15}$/.test(digits)) return null;
  const cc = /^\+\d{1,4}$/.test(config.defaultCountryCode) ? config.defaultCountryCode : "+91";
  const value = hasPlus ? `+${digits}` : `${cc}${digits}`;
  return STORED_RE.test(value) ? value : null;
}

export const phoneFieldType: FieldType<string, PhoneConfig> = makeContactType<PhoneConfig>({
  id: "phone",
  label: "Phone",
  configSchema: phoneConfigSchema,
  defaultConfig: { defaultCountryCode: "+91" },
  normalize: normalizePhone,
  isValid: (v) => STORED_RE.test(v),
  errorMessage: "Invalid phone number",
});
