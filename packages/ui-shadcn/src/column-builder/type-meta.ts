import {
  AlignLeft,
  CalendarClock,
  Calendar,
  CircleChevronDown,
  CircleUser,
  Coins,
  Globe,
  Hash,
  Link2,
  ListChecks,
  ListPlus,
  Mail,
  Phone,
  Puzzle,
  Sigma,
  SquareCheck,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { AnyFieldType, FieldTypeId } from "../internal/core-contracts";

export interface FieldTypeMeta {
  icon: LucideIcon;
  /** One line under the label in pickers. */
  description: string;
  /** Short guidance shown next to the type's settings. */
  hint: string;
  /** A concrete example of the kind of value it holds. */
  example?: string;
}

const META: Record<string, FieldTypeMeta> = {
  text: {
    icon: Type,
    description: "A single line of text",
    hint: "Names, IDs, short answers. Searchable and sortable A–Z.",
    example: "Asha Rao",
  },
  longText: {
    icon: AlignLeft,
    description: "Multiple lines, notes and comments",
    hint: "For free-form notes. Cells show the first line; the editor expands.",
    example: "Called twice, prefers email",
  },
  number: {
    icon: Hash,
    description: "Integers or decimals",
    hint: "Set decimals and grouping; sums and averages show in group rows.",
    example: "42",
  },
  currency: {
    icon: Coins,
    description: "An amount in one currency",
    hint: "Stored as a plain number, displayed with the currency symbol.",
    example: "₹1,23,456.00",
  },
  boolean: {
    icon: SquareCheck,
    description: "A yes / no checkbox",
    hint: "Good for flags like “Verified”. Filters as Is checked / Is not checked.",
  },
  date: {
    icon: Calendar,
    description: "A calendar day, no time",
    hint: "Birthdays, deadlines. Relative filters like “Next 7 days” work on it.",
    example: "15/01/2026",
  },
  datetime: {
    icon: CalendarClock,
    description: "A day and a time, in a time zone",
    hint: "Call slots and timestamps. Values are shown in the chosen time zone.",
    example: "15/01/2026 3:00 pm",
  },
  select: {
    icon: CircleChevronDown,
    description: "One option from a list",
    hint: "Statuses and stages. Give each option a colour so rows scan at a glance.",
    example: "Paid · Pending · Failed",
  },
  multiSelect: {
    icon: ListChecks,
    description: "Several options from a list",
    hint: "Tags and interests. Each cell can hold any number of options.",
    example: "Python, SQL",
  },
  creatableSelect: {
    icon: ListPlus,
    description: "One option; editors can add new ones",
    hint: "Starts with your list; typing a new value adds it for everyone.",
    example: "Referral source",
  },
  user: {
    icon: CircleUser,
    description: "A teammate",
    hint: "Owners and assignees. Supports the “Me” filter.",
    example: "Vikram Singh",
  },
  url: { icon: Globe, description: "A web link", hint: "Rendered as a clickable link that opens in a new tab.", example: "https://example.com" },
  email: { icon: Mail, description: "An email address", hint: "Validated on entry and rendered as a mailto link.", example: "name@example.com" },
  phone: { icon: Phone, description: "A phone number", hint: "Numbers without a country code get the default one.", example: "+91 98765 43210" },
  link: {
    icon: Link2,
    description: "Records from another table",
    hint: "Points at rows elsewhere; the cell shows their labels.",
    example: "Lead #1",
  },
  formula: {
    icon: Sigma,
    description: "Computed from other columns",
    hint: "Reference columns as {key}. Formula cells are read-only and recompute live.",
    example: "{amount} * 1.18",
  },
};

/** Icon, description and guidance for a field type; custom registry types get a generic entry. */
export function fieldTypeMeta(id: FieldTypeId, fieldType?: Pick<AnyFieldType, "label"> | undefined): FieldTypeMeta {
  return (
    META[id] ?? {
      icon: Puzzle,
      description: fieldType ? `Custom type · ${id}` : id,
      hint: "A custom field type registered by this app.",
    }
  );
}
