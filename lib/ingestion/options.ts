import { z } from "zod";
import { IngestionError } from "./errors.ts";
import { careerTargetSchema } from "../career/profile.ts";
import type { SearchOptions } from "./contracts.ts";

const DAY_MS = 86400000;
const LIVE_WINDOW_GRACE_MS = 15 * 60 * 1000;
const optionsSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    limit: z.number().int().min(1).max(10),
    profile: z.enum(["founder", "career"]).optional(),
    searches: z.number().int().min(1).max(12).optional(),
    intent: z.enum(["refresh", "expand"]).optional(),
    search_focus: z.enum(["balanced", "product"]).optional(),
    career_target: careerTargetSchema.optional(),
  })
  .strict();

/** New commands default to career; absent profiles in saved options stay historical. */
export function defaultSearchOptions(
  now = new Date(),
  profile: NonNullable<SearchOptions["profile"]> = "career",
): SearchOptions {
  return {
    from: now.toISOString(),
    to: new Date(
      now.getTime() + (profile === "career" ? 30 : 14) * DAY_MS,
    ).toISOString(),
    limit: 10,
    profile,
  };
}

export function validateSearchOptions(value: unknown): SearchOptions {
  const result = optionsSchema.safeParse(value);
  if (!result.success) throw new IngestionError("invalid_search_options");
  if (
    result.data.profile !== "career" &&
    ((result.data.searches ?? 3) > 3 ||
      result.data.career_target ||
      result.data.search_focus !== undefined)
  )
    throw new IngestionError("invalid_search_options");
  if (result.data.search_focus === "product" && (result.data.searches ?? 3) > 3)
    throw new IngestionError("invalid_search_options");
  const duration = Date.parse(result.data.to) - Date.parse(result.data.from);
  if (duration <= 0 || duration > 31 * DAY_MS)
    throw new IngestionError("invalid_search_window");
  return result.data;
}

/** Live collection must begin near execution time, before any paid work. */
export function validateLiveSearchWindow(
  options: SearchOptions,
  now = new Date(),
): SearchOptions {
  const validated = validateSearchOptions(options);
  const current = now.getTime();
  if (
    !Number.isFinite(current) ||
    Date.parse(validated.from) < current - LIVE_WINDOW_GRACE_MS ||
    Date.parse(validated.to) <= current
  ) {
    throw new IngestionError("stale_live_window");
  }
  return validated;
}
