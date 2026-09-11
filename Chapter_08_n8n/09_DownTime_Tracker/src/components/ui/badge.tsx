import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-muted text-foreground",
        outline: "border-border bg-background text-muted-foreground",
        info: "border-status-info-border bg-status-info-soft text-status-info-strong",
        success: "border-status-healthy-border bg-status-healthy-soft text-status-healthy-strong",
        warning: "border-status-degraded-border bg-status-degraded-soft text-status-degraded-strong",
        danger: "border-status-down-border bg-status-down-soft text-status-down-strong",
        neutral: "border-status-unknown-border bg-status-unknown-soft text-status-unknown-strong",
      },
      size: {
        default: "px-2.5 py-0.5 text-xs",
        sm: "px-2 py-0.5 text-2xs",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
