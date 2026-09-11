"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ENVIRONMENTS } from "@/lib/constants";
import { Select } from "@/components/ui/input";
import type { Environment } from "@/types";

/**
 * Environment switcher (QA / Staging / Production). The selection is stored in
 * the `?env=` query parameter so server components can load the matching data
 * set and deep links stay shareable.
 */
export function EnvironmentSelector({ environment }: { environment: Environment }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("env", next);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-2xs font-semibold uppercase tracking-wide text-muted-foreground lg:block">
        Environment
      </span>
      <Select
        aria-label="Environment"
        value={environment}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-[7.5rem] text-xs font-medium"
      >
        {ENVIRONMENTS.map((env) => (
          <option key={env} value={env}>
            {env}
          </option>
        ))}
      </Select>
    </div>
  );
}
