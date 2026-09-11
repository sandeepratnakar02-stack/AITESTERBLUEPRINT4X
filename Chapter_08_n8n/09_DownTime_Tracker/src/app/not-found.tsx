import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">404</p>
      <h1 className="text-lg font-semibold tracking-tight">We could not find that resource</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The service, incident or page you requested does not exist in the current monitoring data.
      </p>
      <Link href="/" className={cn(buttonVariants(), "mt-1")}>
        Back to dashboard
      </Link>
    </div>
  );
}
