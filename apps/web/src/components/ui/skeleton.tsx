import type * as React from "react";
import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton-shimmer max-w-full rounded-[6px]", className)}
      {...props}
    />
  );
}

export { Skeleton };
