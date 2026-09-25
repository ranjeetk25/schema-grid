import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "sg:inline-flex sg:h-[18px] sg:min-w-[18px] sg:items-center sg:justify-center sg:rounded-xs sg:border sg:border-border sg:bg-subtle sg:px-1",
        "sg:font-mono sg:text-2xs sg:font-medium sg:text-muted-foreground sg:select-none",
        className,
      )}
      {...props}
    />
  );
}
