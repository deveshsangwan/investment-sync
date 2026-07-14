import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-semibold",
  {
    variants: {
      variant: {
        default:
          "border-primary/15 bg-primary text-primary-foreground shadow-sm",
        secondary: "border-border/40 bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        positive: "border-positive/20 bg-positive/10 text-positive",
        negative: "border-negative/20 bg-negative/10 text-negative",
        warning: "border-warning/20 bg-warning/10 text-warning",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
