import { cva, type VariantProps } from "class-variance-authority";

/**
 * Button style variants.
 *
 * Kept in a server-safe module (no "use client") so server components such as
 * `app/not-found.tsx` can compose the same styles without crossing the client
 * boundary.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-panel hover:bg-primary/90",
        outline: "border border-border bg-background text-foreground hover:bg-muted/70",
        subtle: "bg-muted text-foreground hover:bg-muted/70",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive: "bg-status-down text-white hover:bg-status-down-strong",
        link: "text-status-info underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs [&_svg]:size-3.5",
        default: "h-9 px-3.5 [&_svg]:size-4",
        lg: "h-10 px-5 [&_svg]:size-4",
        icon: "h-9 w-9 [&_svg]:size-4",
        "icon-sm": "h-8 w-8 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
