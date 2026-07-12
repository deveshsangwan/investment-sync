import type * as React from "react";
import { cn } from "@/lib/utils";

function Progress({
  className,
  value = 0,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value?: number }) {
  return (
    <div
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-secondary",
        className,
      )}
      {...props}
    >
      <div
        className="h-full w-full flex-1 rounded-full bg-primary transition-transform duration-500 ease-out"
        style={{
          transform: `translateX(-${100 - Math.max(0, Math.min(value, 100))}%)`,
        }}
      />
    </div>
  );
}

export { Progress };
