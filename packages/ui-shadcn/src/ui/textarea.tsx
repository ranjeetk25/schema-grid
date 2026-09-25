import { type ComponentProps, forwardRef } from "react";
import { cn } from "../lib/cn";

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        "sg:flex sg:min-h-20 sg:w-full sg:rounded-md sg:border sg:border-input sg:bg-background sg:px-2.5 sg:py-1.5 sg:text-sm sg:shadow-xs",
        "sg:transition-[border-color,box-shadow] sg:duration-150 sg:outline-none",
        "sg:hover:border-input-hover sg:focus-visible:border-primary sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
        "sg:disabled:cursor-not-allowed sg:disabled:opacity-50 sg:aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
});
