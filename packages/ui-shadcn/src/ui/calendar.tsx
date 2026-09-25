import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { DayPicker } from "react-day-picker";
import { cn } from "../lib/cn";

/**
 * react-day-picker v9 styled to the kit: 28px day cells, accent selection,
 * outlined "today", tabular numerals.
 */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("sg:p-2 sg:tabular-nums", className)}
      classNames={{
        root: "sg:w-fit",
        months: "sg:relative sg:flex sg:flex-col sg:gap-3",
        month: "sg:flex sg:w-full sg:flex-col sg:gap-2",
        nav: "sg:absolute sg:inset-x-0 sg:top-0 sg:flex sg:items-center sg:justify-between",
        button_previous:
          "sg:inline-flex sg:size-7 sg:items-center sg:justify-center sg:rounded-md sg:text-muted-foreground sg:outline-none sg:hover:bg-muted sg:hover:text-foreground sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring sg:aria-disabled:opacity-40",
        button_next:
          "sg:inline-flex sg:size-7 sg:items-center sg:justify-center sg:rounded-md sg:text-muted-foreground sg:outline-none sg:hover:bg-muted sg:hover:text-foreground sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring sg:aria-disabled:opacity-40",
        month_caption: "sg:flex sg:h-7 sg:items-center sg:justify-center",
        caption_label: "sg:text-sm sg:font-medium",
        month_grid: "sg:w-full sg:border-collapse",
        weekdays: "sg:flex",
        weekday: "sg:w-8 sg:text-center sg:text-2xs sg:font-medium sg:text-faint-foreground sg:uppercase",
        week: "sg:mt-0.5 sg:flex sg:w-full",
        day: "sg:size-8 sg:p-0 sg:text-center",
        day_button: cn(
          "sg:inline-flex sg:size-8 sg:items-center sg:justify-center sg:rounded-md sg:text-sm sg:outline-none",
          "sg:hover:bg-muted sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
        ),
        selected:
          "sg:[&>button]:bg-primary sg:[&>button]:font-medium sg:[&>button]:text-primary-foreground sg:[&>button]:hover:bg-primary-hover",
        today: "sg:[&>button]:font-semibold sg:[&>button]:text-primary",
        outside: "sg:[&>button]:text-faint-foreground",
        disabled: "sg:opacity-40",
        hidden: "sg:invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? <ChevronLeftIcon className="sg:size-4" /> : <ChevronRightIcon className="sg:size-4" />,
      }}
      {...props}
    />
  );
}
