import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-10 shrink-0 bg-foreground", className)}
      style={{
        maskImage: "url(/brand/quiet.png)",
        maskMode: "luminance",
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
}
