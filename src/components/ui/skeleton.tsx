import { cn } from "@/lib/utils";

// A subtle, theme-aware shimmer block. bg-foreground/10 reads as light-grey in light mode and a
// faint light-on-dark block in dark mode, so it works for both themes without per-theme classes.
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-foreground/10", className)} {...props} />;
}
