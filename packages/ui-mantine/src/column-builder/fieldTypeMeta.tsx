import {
  IconAlignLeft,
  IconCalendar,
  IconCalendarTime,
  IconCircleDot,
  IconCirclePlus,
  IconCurrencyRupee,
  IconHash,
  IconLetterT,
  IconLinkPlus,
  IconMail,
  IconMathFunction,
  IconPhone,
  IconSquareCheck,
  IconTags,
  IconUser,
  IconWorld,
  type Icon,
} from "../internal/icons";

export interface FieldTypeMeta {
  icon: Icon;
  /** One line, human: what the column holds. */
  description: string;
}

/** Icons + one-line descriptions for the built-in field types (UI copy only; ids never reach the user). */
export const FIELD_TYPE_META: Record<string, FieldTypeMeta> = {
  text: { icon: IconLetterT, description: "Free text, single line" },
  longText: { icon: IconAlignLeft, description: "Notes and paragraphs" },
  number: { icon: IconHash, description: "Numbers, with optional min and max" },
  currency: { icon: IconCurrencyRupee, description: "Money in one currency" },
  boolean: { icon: IconSquareCheck, description: "A yes / no checkbox" },
  date: { icon: IconCalendar, description: "A calendar date" },
  datetime: { icon: IconCalendarTime, description: "A date with a time" },
  select: { icon: IconCircleDot, description: "Choose one option from a list" },
  multiSelect: { icon: IconTags, description: "Choose several options (tags)" },
  creatableSelect: { icon: IconCirclePlus, description: "Choose one option; users can add new ones" },
  user: { icon: IconUser, description: "A person on your team" },
  url: { icon: IconWorld, description: "A web link" },
  email: { icon: IconMail, description: "An email address" },
  phone: { icon: IconPhone, description: "A phone number" },
  link: { icon: IconLinkPlus, description: "Links to records in another table" },
  formula: { icon: IconMathFunction, description: "Computed from other columns" },
};

const FALLBACK: FieldTypeMeta = { icon: IconLetterT, description: "Custom field type" };

export function fieldTypeMeta(id: string | null | undefined): FieldTypeMeta {
  return (id && FIELD_TYPE_META[id]) || FALLBACK;
}

/** Display order for the type picker (common types first); unknown custom types follow in registry order. */
export const FIELD_TYPE_ORDER = [
  "text",
  "longText",
  "number",
  "currency",
  "select",
  "multiSelect",
  "creatableSelect",
  "boolean",
  "date",
  "datetime",
  "user",
  "email",
  "phone",
  "url",
  "link",
  "formula",
];

export function sortFieldTypes<T extends { id: string }>(types: readonly T[]): T[] {
  const rank = (id: string) => {
    const i = FIELD_TYPE_ORDER.indexOf(id);
    return i === -1 ? FIELD_TYPE_ORDER.length : i;
  };
  return [...types].sort((a, b) => rank(a.id) - rank(b.id));
}
