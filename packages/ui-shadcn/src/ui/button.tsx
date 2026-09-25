import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import { type ComponentProps, forwardRef } from "react";
import { cn } from "../lib/cn";

export const buttonVariants = cva(
  [
    "sg:inline-flex sg:shrink-0 sg:items-center sg:justify-center sg:gap-1.5 sg:whitespace-nowrap sg:rounded-md sg:text-sm sg:font-medium",
    "sg:transition-[color,background-color,border-color,box-shadow] sg:duration-150 sg:outline-none sg:select-none",
    "sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
    "sg:disabled:pointer-events-none sg:disabled:opacity-40",
    "sg:[&_svg]:pointer-events-none sg:[&_svg]:shrink-0 sg:[&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        /** The ONE primary CTA per surface. */
        primary: "sg:bg-primary sg:text-primary-foreground sg:shadow-xs sg:hover:bg-primary-hover",
        /** Neutral outlined button — the default secondary action. */
        secondary:
          "sg:border sg:border-input sg:bg-background sg:text-foreground sg:shadow-xs sg:hover:border-input-hover sg:hover:bg-subtle",
        ghost: "sg:text-foreground sg:hover:bg-muted",
        subtle: "sg:text-muted-foreground sg:hover:bg-muted sg:hover:text-foreground",
        danger: "sg:text-danger sg:hover:bg-danger-subtle",
        link: "sg:h-auto sg:px-0 sg:text-primary sg:underline-offset-4 sg:hover:underline",
      },
      size: {
        xs: "sg:h-6 sg:gap-1 sg:rounded-sm sg:px-2 sg:text-xs sg:[&_svg:not([class*='size-'])]:size-3.5",
        sm: "sg:h-7 sg:px-2.5",
        md: "sg:h-8 sg:px-3",
        lg: "sg:h-9 sg:px-4 sg:text-base",
        icon: "sg:size-8",
        "icon-sm": "sg:size-7",
        "icon-xs": "sg:size-6 sg:rounded-sm sg:[&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      data-slot="button"
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});
