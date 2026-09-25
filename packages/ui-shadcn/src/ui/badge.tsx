import { type VariantProps, cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "sg:inline-flex sg:h-5 sg:max-w-full sg:shrink-0 sg:items-center sg:gap-1 sg:rounded-sm sg:px-1.5 sg:text-xs sg:font-medium sg:whitespace-nowrap sg:tabular-nums",
  {
    variants: {
      variant: {
        neutral: "sg:bg-muted sg:text-muted-foreground",
        primary: "sg:bg-primary-subtle sg:text-primary",
        outline: "sg:border sg:border-border sg:text-muted-foreground",
        danger: "sg:bg-danger-subtle sg:text-danger",
        /** Colours come from `style` (option tones); see `OptionBadge`. */
        tone: "sg:bg-[var(--sg-tone-bg)] sg:text-[var(--sg-tone-fg)]",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
