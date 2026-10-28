import type { SearchOptions, SourceIdentity } from "./contracts.ts";
import { ORGANIZER_SOURCES, organizerListing } from "../source-registry.ts";

export const ALLOWED_DOMAINS = [
  "luma.com",
  "lu.ma",
  "meetup.com",
  "eventbrite.com",
  ...ORGANIZER_SOURCES.map((source) => source.host),
];
const MARKETPLACE_DOMAINS = [
  "luma.com",
  "lu.ma",
  "meetup.com",
  "eventbrite.com",
] as const;
export const MAX_RESEARCH_EXCLUSIONS = 50;

export function allowedDomainsForScope(
  scope: SearchOptions["source_scope"] = "all",
): string[] {
  if (scope === "marketplace") return [...MARKETPLACE_DOMAINS];
  if (scope === "product_circle") return ["productcircle.co"];
  return [...ALLOWED_DOMAINS];
}

export function sourceMatchesScope(
  source: SourceIdentity,
  scope: SearchOptions["source_scope"] = "all",
): boolean {
  if (scope === "all") return true;
  return allowedDomainsForScope(scope).includes(source.source_name);
}

/** Normalize identity only; no HTTP requests are made to model-provided URLs. */
export function sourceIdentity(value: string): SourceIdentity | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    if (!ALLOWED_DOMAINS.includes(host)) return null;
    url.hostname = host === "lu.ma" ? "luma.com" : host;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["fbclid", "gclid"].includes(key))
        url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (ORGANIZER_SOURCES.some((entry) => entry.host === host)) {
      const listing = organizerListing(url);
      return listing
        ? {
            source_name: host,
            source_url: listing.url,
            external_id: listing.externalId,
          }
        : null;
    }
    let externalId: string | null = null;
    if (host === "meetup.com") {
      externalId = url.pathname.match(/^\/[^/]+\/events\/(\d+)$/)?.[1] ?? null;
      if (!externalId) return null;
    } else if (host === "eventbrite.com") {
      externalId = url.pathname.match(/^\/e\/[^/]*tickets-(\d+)$/)?.[1] ?? null;
      if (!externalId) return null;
    } else if (
      !/^\/[a-zA-Z0-9_-]+$/.test(url.pathname) ||
      /^\/(discover|explore|home|signin|login|pricing|calendar|create|nyc|new-york)$/i.test(
        url.pathname,
      )
    ) {
      return null;
    }
    return {
      source_name: url.hostname,
      source_url: url.toString(),
      external_id: externalId,
    };
  } catch {
    return null;
  }
}

export function selectSources(
  urls: string[],
  limit: number,
  excludedUrls: string[] = [],
  scope: SearchOptions["source_scope"] = "all",
): SourceIdentity[] {
  const selected = new Map<string, SourceIdentity>();
  const externalIds = new Set<string>();
  const excludedSources = excludedUrls
    .map((url) => sourceIdentity(url))
    .filter((source): source is SourceIdentity => source !== null);
  const excludedCanonicalUrls = new Set(
    excludedSources.map((source) => source.source_url),
  );
  const excludedExternalIds = new Set(
    excludedSources
      .filter((source) => source.external_id !== null)
      .map((source) => source.source_name + ":" + source.external_id),
  );
  for (const url of urls) {
    const source = sourceIdentity(url);
    if (!source || !sourceMatchesScope(source, scope)) continue;
    const id = source.external_id
      ? source.source_name + ":" + source.external_id
      : null;
    if (
      excludedCanonicalUrls.has(source.source_url) ||
      (id && excludedExternalIds.has(id)) ||
      selected.has(source.source_url) ||
      (id && externalIds.has(id))
    )
      continue;
    selected.set(source.source_url, source);
    if (id) externalIds.add(id);
    if (selected.size >= limit) break;
  }
  return [...selected.values()];
}
