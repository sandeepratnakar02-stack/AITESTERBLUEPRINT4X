import { ENVIRONMENTS } from "@/lib/constants";
import type { Environment } from "@/types";

/** Reads and validates the `?env=` query parameter used across the dashboard. */
export function normalizeEnvironment(value?: string | string[] | null): Environment {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = ENVIRONMENTS.find((env) => env.toLowerCase() === (raw ?? "").toLowerCase());
  return match ?? "QA";
}
