import { type ComponentProps, forwardRef } from "react";
import { cn } from "../lib/cn";

export const inputClasses = cn(
  "sg:flex sg:h-8 sg:w-full sg:min-w-0 sg:rounded-md sg:border sg:border-input sg:bg-background sg:px-2.5 sg:text-sm sg:text-foreground sg:shadow-xs",
  "sg:transition-[border-color,box-shadow] sg:duration-150 sg:outline-none",
  "sg:hover:border-input-hover sg:focus-visible:border-primary sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
  "sg:disabled:cursor-not-allowed sg:disabled:opacity-50 sg:read-only:bg-subtle",
  "sg:aria-invalid:border-danger sg:aria-invalid:focus-visible:ring-danger-subtle",
  "sg:tabular-nums",
);

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input({ className, type, ...props }, ref) {
  return <input ref={ref} type={type} data-slot="input" className={cn(inputClasses, className)} {...props} />;
});
