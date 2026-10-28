import "server-only";
import { z } from "zod";
import type { IngestionRepository, SearchOptions } from "./contracts.ts";
import {
  allowedDomainsForScope,
  MAX_RESEARCH_EXCLUSIONS,
  selectSources,
} from "./sources.ts";

const CANCELLED_SOURCE_EXCLUSION_DAYS = 90;
const DAY_MS = 86400000;
const boundedCount = z.number().int().min(0).max(MAX_RESEARCH_EXCLUSIONS);
const summarySchema = z
  .object({
    intent: z.enum(["refresh", "expand"]),
    maximum_sources: z.literal(MAX_RESEARCH_EXCLUSIONS),
    cancelled_source_count: boundedCount,
    linked_source_count: boundedCount,
    total_source_count: boundedCount,
    cancelled_candidates_truncated: z.boolean(),
    linked_candidates_truncated: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();

export type DiscoveryExclusionSummary = z.infer<typeof summarySchema>;

/** Describe policy without reading credentials, storage, or the network. */
export function discoveryExclusionPlan(options: SearchOptions) {
  return {
    intent: options.intent ?? "refresh",
    policy:
      options.intent === "expand"
        ? "recent_cancelled_and_linked_non_fixture_events_in_window"
        : "recent_cancelled_sources",
    maximum_sources: MAX_RESEARCH_EXCLUSIONS,
    cancelled_source_count: null,
    linked_source_count: null,
    total_source_count: null,
    truncated: null,
  };
}

/** Retain only bounded, consistent counts; never expose the private URL set. */
export function safeDiscoveryExclusions(
  value: unknown,
): DiscoveryExclusionSummary | null {
  const parsed = summarySchema.safeParse(value);
  if (!parsed.success) return null;
  const summary = parsed.data;
  if (
    summary.total_source_count !==
      summary.cancelled_source_count + summary.linked_source_count ||
    (summary.intent === "refresh" &&
      (summary.linked_source_count !== 0 ||
        summary.linked_candidates_truncated)) ||
    summary.truncated !==
      (summary.cancelled_candidates_truncated ||
        summary.linked_candidates_truncated)
  )
    return null;
  return summary;
}

/** Read at most cap + one sentinel per query, then merge with cancelled priority. */
export async function collectDiscoveryExclusions(
  options: SearchOptions,
  repository: IngestionRepository,
  now: Date,
): Promise<{ urls: string[]; summary: DiscoveryExclusionSummary }> {
  const since = new Date(
    now.getTime() - CANCELLED_SOURCE_EXCLUSION_DAYS * DAY_MS,
  ).toISOString();
  const probeLimit = MAX_RESEARCH_EXCLUSIONS + 1;
  const sourceNames = allowedDomainsForScope(options.source_scope ?? "all");
  const cancelledRows = await repository.listRecentCancelledSourceUrls(
    since,
    probeLimit,
    sourceNames,
  );
  const cancelled = selectSources(
    cancelledRows,
    MAX_RESEARCH_EXCLUSIONS,
    [],
    options.source_scope,
  ).map((source) => source.source_url);
  const linkedRows =
    options.intent === "expand"
      ? await repository.listLinkedSourceUrls(
          options.from,
          options.to,
          probeLimit,
          sourceNames,
        )
      : [];
  const linked = selectSources(
    linkedRows,
    probeLimit,
    cancelled,
    options.source_scope,
  );
  const remaining = MAX_RESEARCH_EXCLUSIONS - cancelled.length;
  const selectedLinked = linked
    .slice(0, remaining)
    .map((source) => source.source_url);
  const urls = [...cancelled, ...selectedLinked];
  const cancelledTruncated = cancelledRows.length > MAX_RESEARCH_EXCLUSIONS;
  const linkedTruncated =
    linkedRows.length > MAX_RESEARCH_EXCLUSIONS || linked.length > remaining;
  return {
    urls,
    summary: {
      intent: options.intent ?? "refresh",
      maximum_sources: MAX_RESEARCH_EXCLUSIONS,
      cancelled_source_count: cancelled.length,
      linked_source_count: selectedLinked.length,
      total_source_count: urls.length,
      cancelled_candidates_truncated: cancelledTruncated,
      linked_candidates_truncated: linkedTruncated,
      truncated: cancelledTruncated || linkedTruncated,
    },
  };
}
