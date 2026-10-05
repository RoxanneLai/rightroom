import "server-only";
import { z } from "zod";
import type { Json } from "../database.types.ts";
import { candidateSchema } from "./contracts.ts";
import {
  careerCandidateSchema,
  schemaForProfile,
  outputSchemaForProfile,
} from "../career/contracts.ts";
import { careerSearchPlan } from "../career/profile.ts";
import {
  CAREER_RESEARCH_INSTRUCTIONS,
  CAREER_EXTRACTION_INSTRUCTIONS,
  CAREER_REPAIR_INSTRUCTIONS,
} from "../career/prompts.ts";

function candidateContract(value: unknown) {
  return value && typeof value === "object" && "career" in value
    ? careerCandidateSchema
    : candidateSchema;
}
import type {
  DiscoveryProvider,
  Extraction,
  ProviderDiagnostic,
  ReasoningEffort,
  Research,
  SearchOptions,
  SourceIdentity,
} from "./contracts.ts";
import {
  ALLOWED_DOMAINS,
  MAX_RESEARCH_EXCLUSIONS,
  selectSources,
  sourceIdentity,
} from "./sources.ts";
import { IngestionError, errorCode } from "./errors.ts";
import { validateSearchOptions } from "./options.ts";
import {
  EXTRACTION_INSTRUCTIONS,
  REPAIR_INSTRUCTIONS,
  RESEARCH_INSTRUCTIONS,
  extractionInput,
  repairInput,
  researchInput,
} from "./prompts.ts";
import {
  parseRouterResponse,
  providerHttpError,
  readResponseJson,
  routerMetadata,
} from "./openrouter-response.ts";
import type { RouterResponse } from "./openrouter-response.ts";
import { routerDiagnostic } from "./openrouter-diagnostics.ts";
import { parseStructuredContent } from "./structured-output.ts";
import { sourceRetrievalUrl, validateCapturedPages } from "./source-page.ts";
import { CAPTURED_EXTRACTION_INSTRUCTIONS } from "./prompts.ts";
import { CAPTURED_CAREER_EXTRACTION_INSTRUCTIONS } from "../career/prompts.ts";
import { researchSelection } from "./research-selection.ts";

export const API_LIMITS = {
  calls: 3,
  primaryCalls: 2,
  repairCalls: 1,
  searchToolCalls: 3,
  fetchToolCalls: 10,
  fetchContentTokens: 6000,
  searchResultsPerCall: 5,
  totalSearchResults: 15,
  searchResultCharacters: 2000,
  researchOutputTokens: 6000,
  extractionOutputTokens: 12000,
  repairOutputTokens: 6000,
  repairInputCharacters: 60000,
  requestTimeoutMs: 120000,
  reportCharacters: 40000,
  responseBytes: 1048576,
  researchExcludedSources: MAX_RESEARCH_EXCLUSIONS,
} as const;

const MAX_REPAIR_MISMATCH_PATHS = 32;

const flatText = z.string().nullable();
const flatQuote = z.string().nullable();
const flatVerificationReason = z
  .enum([
    "source_fetch_failed",
    "source_not_event_listing",
    "source_page_conflict",
    "source_page_past",
    "source_page_cancelled",
    "source_page_virtual_only",
    "source_evidence_insufficient",
    "failed_fetch",
    "cancelled",
  ])
  .nullable();
const flatCandidateSchema = z
  .object({
    source_url: z.string(),
    source_verification: z
      .object({
        status: z.enum(["verified", "rejected"]),
        reason: flatVerificationReason,
      })
      .strict(),
    title: flatText,
    title_quote: flatQuote,
    starts_at: flatText,
    starts_at_quote: flatQuote,
    ends_at: flatText,
    ends_at_quote: flatQuote,
    time_zone: flatText,
    time_zone_quote: flatQuote,
    venue_name: flatText,
    venue_name_quote: flatQuote,
    city: flatText,
    city_quote: flatQuote,
    region: flatText,
    region_quote: flatQuote,
    country_code: flatText,
    country_code_quote: flatQuote,
    event_format: flatText,
    event_format_quote: flatQuote,
    founder_investor_relevance: z.boolean().nullable(),
    founder_investor_relevance_quote: flatQuote,
    organizer: flatText,
    organizer_quote: flatQuote,
    price_amount_cents: z.number().int().min(0).max(2147483647).nullable(),
    price_amount_cents_quote: flatQuote,
    currency_code: flatText,
    currency_code_quote: flatQuote,
    registration_status: flatText,
    registration_status_quote: flatQuote,
  })
  .strict()
  .superRefine((candidate, context) => {
    const facts = [
      [candidate.title, candidate.title_quote],
      [candidate.starts_at, candidate.starts_at_quote],
      [candidate.ends_at, candidate.ends_at_quote],
      [candidate.time_zone, candidate.time_zone_quote],
      [candidate.venue_name, candidate.venue_name_quote],
      [candidate.city, candidate.city_quote],
      [candidate.region, candidate.region_quote],
      [candidate.country_code, candidate.country_code_quote],
      [candidate.event_format, candidate.event_format_quote],
      [
        candidate.founder_investor_relevance,
        candidate.founder_investor_relevance_quote,
      ],
      [candidate.organizer, candidate.organizer_quote],
      [candidate.price_amount_cents, candidate.price_amount_cents_quote],
      [candidate.currency_code, candidate.currency_code_quote],
      [candidate.registration_status, candidate.registration_status_quote],
    ];
    const rejected = candidate.source_verification.status === "rejected";
    const invalid = rejected
      ? candidate.source_verification.reason === null ||
        facts.some(([value, quote]) => value !== null || quote !== null)
      : candidate.source_verification.reason !== null;
    if (invalid)
      context.addIssue({
        code: "custom",
        message: "inconsistent flat source verification verdict",
      });
  });

const alternateFlatCandidateSchema = z
  .object({
    source_url: z.string(),
    source_verification: z
      .object({
        status: z.enum(["verified", "rejected"]),
        reason: flatVerificationReason,
      })
      .strict(),
    title: flatText,
    title_quote: flatQuote,
    starts_at: flatText,
    starts_at_quote: flatQuote,
    ends_at: flatText,
    ends_at_quote: flatQuote,
    time_zone: flatText,
    time_zone_quote: flatQuote,
    venue: flatText,
    venue_quote: flatQuote,
    city: flatText,
    city_quote: flatQuote,
    region: flatText,
    region_quote: flatQuote,
    country_code: flatText,
    country_code_quote: flatQuote,
    event_format: flatText,
    event_format_quote: flatQuote,
    relevant_to_founders: z.boolean().nullable(),
    relevance_quote: flatQuote,
    organizer: flatText,
    organizer_quote: flatQuote,
    price_amount_cents: z.number().int().min(0).max(2147483647).nullable(),
    price_amount_cents_quote: flatQuote,
    currency_code: flatText,
    currency_code_quote: flatQuote,
    registration_status: flatText,
    registration_status_quote: flatQuote,
  })
  .strict()
  .superRefine((candidate, context) => {
    const facts = [
      [candidate.title, candidate.title_quote],
      [candidate.starts_at, candidate.starts_at_quote],
      [candidate.ends_at, candidate.ends_at_quote],
      [candidate.time_zone, candidate.time_zone_quote],
      [candidate.venue, candidate.venue_quote],
      [candidate.city, candidate.city_quote],
      [candidate.region, candidate.region_quote],
      [candidate.country_code, candidate.country_code_quote],
      [candidate.event_format, candidate.event_format_quote],
      [candidate.relevant_to_founders, candidate.relevance_quote],
      [candidate.organizer, candidate.organizer_quote],
      [candidate.price_amount_cents, candidate.price_amount_cents_quote],
      [candidate.currency_code, candidate.currency_code_quote],
      [candidate.registration_status, candidate.registration_status_quote],
    ];
    const rejected = candidate.source_verification.status === "rejected";
    const invalid = rejected
      ? candidate.source_verification.reason === null ||
        facts.some(([value, quote]) => value !== null || quote !== null)
      : candidate.source_verification.reason !== null;
    if (invalid)
      context.addIssue({
        code: "custom",
        message: "inconsistent alternate flat source verification verdict",
      });
  });

const legacyNestedTextFact = z
  .object({ value: z.string().nullable(), quote: z.string().nullable() })
  .strict();
const legacyNestedPriceFact = z
  .object({
    value: z.number().int().min(0).max(2147483647).nullable(),
    quote: z.string().nullable(),
  })
  .strict();
const legacyNestedCandidateSchema = z
  .object({
    source_url: z.string(),
    source_verification: z
      .object({
        status: z.enum(["verified", "rejected"]),
        reason: flatVerificationReason,
      })
      .strict(),
    title: legacyNestedTextFact,
    starts_at: legacyNestedTextFact,
    ends_at: legacyNestedTextFact,
    time_zone: legacyNestedTextFact,
    venue: legacyNestedTextFact,
    city: legacyNestedTextFact,
    region: legacyNestedTextFact,
    country_code: legacyNestedTextFact,
    event_format: legacyNestedTextFact,
    founder_investor_relevance: legacyNestedTextFact,
    organizer: legacyNestedTextFact,
    price_amount_cents: legacyNestedPriceFact,
    currency_code: legacyNestedTextFact,
    registration_status: legacyNestedTextFact,
  })
  .strict();

function fact<T>(value: T | null, quote: string | null) {
  return { value, quote };
}

function canonicalCandidate(value: unknown): {
  value: unknown;
  format: "canonical" | "legacy_flat" | "legacy_nested" | "invalid";
} {
  if (candidateContract(value).safeParse(value).success)
    return { value, format: "canonical" };
  const flat = flatCandidateSchema.safeParse(value);
  if (flat.success) return canonicalFlatCandidate(flat.data, value);
  const alternateFlat = alternateFlatCandidateSchema.safeParse(value);
  if (alternateFlat.success)
    return canonicalAlternateFlatCandidate(alternateFlat.data, value);
  const nested = legacyNestedCandidateSchema.safeParse(value);
  if (nested.success) return canonicalNestedCandidate(nested.data, value);
  return { value, format: "invalid" };
}

function canonicalReason(reason: z.infer<typeof flatVerificationReason>) {
  if (reason === "failed_fetch") return "source_fetch_failed";
  if (reason === "cancelled") return "source_page_cancelled";
  return reason;
}

function canonicalFlatCandidate(
  candidate: z.infer<typeof flatCandidateSchema>,
  original: unknown,
): {
  value: unknown;
  format: "legacy_flat" | "invalid";
} {
  const reason = canonicalReason(candidate.source_verification.reason);
  const canonical = {
    source_url: candidate.source_url,
    source_verification: {
      status: candidate.source_verification.status,
      reason,
    },
    relevant_to_founders: fact(
      candidate.founder_investor_relevance,
      candidate.founder_investor_relevance_quote,
    ),
    title: fact(candidate.title, candidate.title_quote),
    organizer_name: fact(candidate.organizer, candidate.organizer_quote),
    starts_at: fact(candidate.starts_at, candidate.starts_at_quote),
    ends_at: fact(candidate.ends_at, candidate.ends_at_quote),
    time_zone: fact(candidate.time_zone, candidate.time_zone_quote),
    venue_name: fact(candidate.venue_name, candidate.venue_name_quote),
    address_line: fact(null, null),
    city: fact(candidate.city, candidate.city_quote),
    region: fact(candidate.region, candidate.region_quote),
    country_code: fact(candidate.country_code, candidate.country_code_quote),
    event_format: fact(candidate.event_format, candidate.event_format_quote),
    price_amount_cents: fact(
      candidate.price_amount_cents,
      candidate.price_amount_cents_quote,
    ),
    currency_code: fact(candidate.currency_code, candidate.currency_code_quote),
    registration_status: fact(
      candidate.registration_status,
      candidate.registration_status_quote,
    ),
  };
  return candidateSchema.safeParse(canonical).success
    ? { value: canonical, format: "legacy_flat" }
    : { value: original, format: "invalid" };
}

function canonicalAlternateFlatCandidate(
  candidate: z.infer<typeof alternateFlatCandidateSchema>,
  original: unknown,
): {
  value: unknown;
  format: "legacy_flat" | "invalid";
} {
  return canonicalFlatCandidate(
    {
      source_url: candidate.source_url,
      source_verification: candidate.source_verification,
      title: candidate.title,
      title_quote: candidate.title_quote,
      starts_at: candidate.starts_at,
      starts_at_quote: candidate.starts_at_quote,
      ends_at: candidate.ends_at,
      ends_at_quote: candidate.ends_at_quote,
      time_zone: candidate.time_zone,
      time_zone_quote: candidate.time_zone_quote,
      venue_name: candidate.venue,
      venue_name_quote: candidate.venue_quote,
      city: candidate.city,
      city_quote: candidate.city_quote,
      region: candidate.region,
      region_quote: candidate.region_quote,
      country_code: candidate.country_code,
      country_code_quote: candidate.country_code_quote,
      event_format: candidate.event_format,
      event_format_quote: candidate.event_format_quote,
      founder_investor_relevance: candidate.relevant_to_founders,
      founder_investor_relevance_quote: candidate.relevance_quote,
      organizer: candidate.organizer,
      organizer_quote: candidate.organizer_quote,
      price_amount_cents: candidate.price_amount_cents,
      price_amount_cents_quote: candidate.price_amount_cents_quote,
      currency_code: candidate.currency_code,
      currency_code_quote: candidate.currency_code_quote,
      registration_status: candidate.registration_status,
      registration_status_quote: candidate.registration_status_quote,
    },
    original,
  );
}

function canonicalNestedCandidate(
  candidate: z.infer<typeof legacyNestedCandidateSchema>,
  original: unknown,
): {
  value: unknown;
  format: "legacy_nested" | "invalid";
} {
  const relevance = candidate.founder_investor_relevance;
  const canonical = {
    source_url: candidate.source_url,
    source_verification: {
      status: candidate.source_verification.status,
      reason: canonicalReason(candidate.source_verification.reason),
    },
    relevant_to_founders: fact(
      relevance.value === null ? null : true,
      relevance.quote,
    ),
    title: candidate.title,
    organizer_name: candidate.organizer,
    starts_at: candidate.starts_at,
    ends_at: candidate.ends_at,
    time_zone: candidate.time_zone,
    venue_name: candidate.venue,
    address_line: fact(null, null),
    city: candidate.city,
    region: candidate.region,
    country_code: candidate.country_code,
    event_format: candidate.event_format,
    price_amount_cents: candidate.price_amount_cents,
    currency_code: candidate.currency_code,
    registration_status: candidate.registration_status,
  };
  return candidateSchema.safeParse(canonical).success
    ? { value: canonical, format: "legacy_nested" }
    : { value: original, format: "invalid" };
}

/** Intersect trusted annotations with canonical listing URLs actually named in the report. */
function reportedSourceUrls(
  response: RouterResponse,
  selected: string[],
): string[] {
  const message = response.choices[0].message;
  const annotated = new Set(
    (message.annotations ?? [])
      .filter(
        (annotation) =>
          annotation.type === "url_citation" && annotation.url_citation,
      )
      .map(
        (annotation) =>
          sourceIdentity(annotation.url_citation!.url)?.source_url,
      )
      .filter((url): url is string => Boolean(url)),
  );
  const collect = (text: string): string[] => {
    const urls: string[] = [];
    for (const match of text.matchAll(/https:\/\/[^\s)\]}>'"]+/g)) {
      const url = sourceIdentity(
        match[0].replace(/[.,;:!?]+$/, ""),
      )?.source_url;
      if (url && annotated.has(url) && !urls.includes(url)) urls.push(url);
    }
    return urls;
  };
  const cited = new Set(collect(message.content ?? ""));
  return selected.filter((url) => cited.has(url));
}

type SourceCoverage = {
  exact: boolean;
  complete: boolean;
};

function inspectSourceCoverage(
  candidates: unknown[],
  sources: SourceIdentity[],
  diagnostic: ProviderDiagnostic,
): SourceCoverage {
  const expected = new Set(sources.map((source) => source.source_url));
  const seen = new Set<string>();
  let schemaValid = 0;
  let duplicates = 0;
  let untrusted = 0;
  for (const candidate of candidates) {
    if (candidateContract(candidate).safeParse(candidate).success)
      schemaValid += 1;
    const url =
      candidate &&
      typeof candidate === "object" &&
      "source_url" in candidate &&
      typeof candidate.source_url === "string"
        ? sourceIdentity(candidate.source_url)?.source_url
        : null;
    if (!url || !expected.has(url)) {
      untrusted += 1;
      continue;
    }
    if (seen.has(url)) {
      duplicates += 1;
      continue;
    }
    seen.add(url);
  }
  diagnostic.extraction_schema_valid_count = schemaValid;
  diagnostic.extraction_source_match_count = seen.size;
  diagnostic.extraction_duplicate_source_count = duplicates;
  diagnostic.extraction_untrusted_source_count = untrusted;
  const exact =
    candidates.length === sources.length &&
    seen.size === expected.size &&
    duplicates === 0 &&
    untrusted === 0;
  return { exact, complete: exact && schemaValid === candidates.length };
}

function extractionCandidates(
  value: unknown,
  diagnostic: ProviderDiagnostic,
  allowEncoded = true,
  canonicalize = true,
): unknown[] | null {
  if (allowEncoded) diagnostic.extraction_shape = "invalid";
  if (typeof value === "string" && allowEncoded) {
    try {
      const nested = extractionCandidates(
        JSON.parse(value),
        diagnostic,
        false,
        canonicalize,
      );
      if (nested) diagnostic.extraction_shape = "encoded_candidate_envelope";
      return nested;
    } catch {
      return null;
    }
  }
  let candidates: unknown[] | null = null;
  if (Array.isArray(value)) {
    diagnostic.extraction_shape = "candidate_array";
    candidates = value;
  } else if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (
      keys.length === 1 &&
      keys[0] === "candidates" &&
      "candidates" in value &&
      Array.isArray(value.candidates)
    ) {
      diagnostic.extraction_shape = "candidates_object";
      candidates = value.candidates;
    } else if (
      keys.length === 1 &&
      keys[0] === "event_candidates" &&
      "event_candidates" in value &&
      Array.isArray(value.event_candidates)
    ) {
      diagnostic.extraction_shape = "schema_named_object";
      candidates = value.event_candidates;
    }
  }
  if (candidates && candidates.length <= 100)
    diagnostic.extraction_candidate_count = candidates.length;
  if (!candidates) return null;
  const converted = candidates.map((candidate) =>
    canonicalize
      ? canonicalCandidate(candidate)
      : {
          value: candidate,
          format: candidateContract(candidate).safeParse(candidate).success
            ? ("canonical" as const)
            : ("invalid" as const),
        },
  );
  const formats = new Set(converted.map((candidate) => candidate.format));
  diagnostic.extraction_candidate_format = formats.has("invalid")
    ? "invalid"
    : formats.size === 1
      ? (converted[0]?.format ?? "invalid")
      : "mixed";
  return converted.map((candidate) => candidate.value);
}

function candidateResponseFormat(count: number, profile?: string) {
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "event_candidates",
      strict: true,
      schema: z.toJSONSchema(
        z
          .object({
            candidates: z.array(outputSchemaForProfile(profile)).length(count),
          })
          .strict(),
      ),
    },
  };
}

function hasRepairableSourceCoverage(
  candidates: unknown[],
  sources: SourceIdentity[],
  diagnostic: ProviderDiagnostic,
): boolean {
  return (
    candidates.length === sources.length &&
    diagnostic.extraction_candidate_count === sources.length &&
    diagnostic.extraction_source_match_count === sources.length &&
    diagnostic.extraction_duplicate_source_count === 0 &&
    diagnostic.extraction_untrusted_source_count === 0 &&
    diagnostic.extraction_schema_valid_count !== sources.length
  );
}

function scalarKey(value: string | number | boolean): string {
  return typeof value + ":" + JSON.stringify(value);
}

function collectScalars(
  value: unknown,
  result = new Set<string>(),
): Set<string> {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    result.add(scalarKey(value));
  } else if (Array.isArray(value)) {
    for (const item of value) collectScalars(item, result);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectScalars(item, result);
  }
  return result;
}

type ScalarEntry = {
  path: string;
  value: string | number | boolean;
};

function collectScalarEntries(
  value: unknown,
  path = "",
  result: ScalarEntry[] = [],
): ScalarEntry[] {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    result.push({ path, value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectScalarEntries(item, `${path}[${index}]`, result),
    );
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      collectScalarEntries(item, path ? `${path}.${key}` : key, result);
  }
  return result;
}

function candidateSourceUrl(value: unknown): string | null {
  return value &&
    typeof value === "object" &&
    "source_url" in value &&
    typeof value.source_url === "string"
    ? (sourceIdentity(value.source_url)?.source_url ?? null)
    : null;
}

type RepairScalarCheck = {
  candidates: unknown[] | null;
  appliedCandidateCount: number;
  usableCandidateCount: number;
  mismatchCount: number | null;
  mismatchPaths: string[] | null;
};

type RepairOriginal = {
  evidence: unknown;
  fallback: unknown;
};

type RepairOriginals = Map<string, RepairOriginal>;

function hasSourceVerdict(value: unknown): boolean {
  const scalars = collectScalars(value);
  return (
    scalars.has(scalarKey("verified")) || scalars.has(scalarKey("rejected"))
  );
}

function matchingSourceUrls(
  value: unknown,
  expected: ReadonlySet<string>,
  result = new Set<string>(),
): Set<string> {
  if (typeof value === "string") {
    const url = sourceIdentity(value)?.source_url;
    if (url && expected.has(url)) result.add(url);
  } else if (Array.isArray(value)) {
    for (const item of value) matchingSourceUrls(item, expected, result);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value))
      matchingSourceUrls(item, expected, result);
  }
  return result;
}

/**
 * Isolate one untrusted JSON subtree per source before asking a model to
 * rearrange it. This prevents a structural repair from copying a fact from
 * one event into another. A single-source response can safely use the whole
 * bounded JSON value because there is no sibling source to contaminate it.
 */
function sourceScopedRepairOriginals(
  value: unknown,
  sources: SourceIdentity[],
): RepairOriginals | null {
  if (
    (!Array.isArray(value) && (!value || typeof value !== "object")) ||
    !sources.length
  )
    return null;
  if (sources.length === 1)
    return hasSourceVerdict(value)
      ? new Map([
          [
            sources[0].source_url,
            {
              evidence: value,
              fallback: { source_url: sources[0].source_url },
            },
          ],
        ])
      : null;

  const expected = new Set(sources.map((source) => source.source_url));
  const scopes: RepairOriginals = new Map();
  let ambiguous = false;
  const visit = (item: unknown): void => {
    if (
      ambiguous ||
      (!Array.isArray(item) && (!item || typeof item !== "object"))
    )
      return;
    const matches = matchingSourceUrls(item, expected);
    if (matches.size === 1 && hasSourceVerdict(item)) {
      const [url] = matches;
      if (!url || scopes.has(url)) {
        ambiguous = true;
        return;
      }
      scopes.set(url, { evidence: item, fallback: { source_url: url } });
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
    } else {
      for (const child of Object.values(item)) visit(child);
    }
  };
  visit(value);
  return !ambiguous && scopes.size === expected.size ? scopes : null;
}

function candidateRepairOriginals(
  candidates: unknown[],
  sources: SourceIdentity[],
  diagnostic: ProviderDiagnostic,
): RepairOriginals | null {
  if (!hasRepairableSourceCoverage(candidates, sources, diagnostic))
    return null;
  const originals: RepairOriginals = new Map();
  for (const candidate of candidates) {
    const url = candidateSourceUrl(candidate);
    if (!url || originals.has(url)) return null;
    originals.set(url, { evidence: candidate, fallback: candidate });
  }
  return originals;
}

/** Keep only independently canonical, fact-preserving repaired siblings. */
function isolateFactPreservingRepairs(
  original: RepairOriginals,
  repaired: unknown[],
): RepairScalarCheck {
  const originals = new Map<
    string,
    { candidate: unknown; scalars: Set<string> }
  >();
  for (const [url, candidate] of original) {
    originals.set(url, {
      candidate: candidate.fallback,
      scalars: collectScalars(candidate.evidence),
    });
  }
  let appliedCandidateCount = 0;
  let usableCandidateCount = 0;
  let mismatchCount = 0;
  const mismatchPaths: string[] = [];
  const candidates: unknown[] = [];
  for (const [index, candidate] of repaired.entries()) {
    const url = candidateSourceUrl(candidate);
    const originalCandidate = url ? originals.get(url) : null;
    if (!originalCandidate)
      return {
        candidates: null,
        appliedCandidateCount: 0,
        usableCandidateCount: 0,
        mismatchCount: null,
        mismatchPaths: null,
      };
    const parsed = candidateContract(candidate).safeParse(candidate);
    if (!parsed.success) {
      candidates.push(originalCandidate.candidate);
      if (
        candidateContract(originalCandidate.candidate).safeParse(
          originalCandidate.candidate,
        ).success
      )
        usableCandidateCount += 1;
      continue;
    }
    const clone = structuredClone(parsed.data) as Record<string, unknown>;
    delete clone.source_url;
    let candidateMismatchCount = 0;
    for (const entry of collectScalarEntries(clone)) {
      const scalar = scalarKey(entry.value);
      if (originalCandidate.scalars.has(scalar)) continue;
      if (
        scalar === scalarKey("source_fetch_failed") &&
        originalCandidate.scalars.has(scalarKey("failed_fetch"))
      )
        continue;
      if (
        scalar === scalarKey("source_page_cancelled") &&
        originalCandidate.scalars.has(scalarKey("cancelled"))
      )
        continue;
      mismatchCount += 1;
      candidateMismatchCount += 1;
      const path = `candidates[${index}].${entry.path}`;
      if (
        mismatchPaths.length < MAX_REPAIR_MISMATCH_PATHS &&
        !mismatchPaths.includes(path)
      )
        mismatchPaths.push(path);
    }
    if (candidateMismatchCount) {
      candidates.push(originalCandidate.candidate);
      if (
        candidateContract(originalCandidate.candidate).safeParse(
          originalCandidate.candidate,
        ).success
      )
        usableCandidateCount += 1;
    } else {
      candidates.push(candidate);
      appliedCandidateCount += 1;
      usableCandidateCount += 1;
    }
  }
  return {
    candidates,
    appliedCandidateCount,
    usableCandidateCount,
    mismatchCount,
    mismatchPaths,
  };
}

/** Fixed HTTPS endpoint; no custom URLs, retries, redirects, or model fallback. */
export function createOpenRouterProvider(
  apiKey: string,
  model: string,
  effort: ReasoningEffort,
  repairModel: string,
  repairEffort: ReasoningEffort,
): DiscoveryProvider {
  return new OpenRouterSearchProvider(
    apiKey,
    model,
    effort,
    fetch,
    repairModel,
    repairEffort,
  );
}

export class OpenRouterSearchProvider implements DiscoveryProvider {
  private searchBudget = 3;
  private calls = 0;
  private primaryCalls = 0;
  private repairCalls = 0;
  private readonly diagnostics: ProviderDiagnostic[] = [];
  private readonly apiKey: string;
  private readonly model: string;
  private readonly effort: ReasoningEffort;
  private readonly repairModel: string;
  private readonly repairEffort: ReasoningEffort;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    model: string,
    effort: ReasoningEffort,
    fetcher: typeof fetch = fetch,
    repairModel = "openai/gpt-5.6-luna",
    repairEffort: ReasoningEffort = "medium",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.effort = effort;
    this.repairModel = repairModel;
    this.repairEffort = repairEffort;
    this.fetcher = fetcher;
  }

  /** Return copies so local progress hooks cannot mutate the recorded diagnostics. */
  getDiagnostics(): ProviderDiagnostic[] {
    return structuredClone(this.diagnostics);
  }

  private async request(
    phase: ProviderDiagnostic["phase"],
    body: Record<string, unknown>,
    signal: AbortSignal,
    requestedModel = this.model,
    requestedEffort = this.effort,
  ): Promise<RouterResponse> {
    if (signal.aborted) throw new IngestionError("run_cancelled");
    const repair = phase === "repair";
    if (
      this.calls >= API_LIMITS.calls ||
      (repair
        ? this.repairCalls >= API_LIMITS.repairCalls
        : this.primaryCalls >= API_LIMITS.primaryCalls)
    )
      throw new IngestionError("api_call_limit");
    this.calls += 1;
    if (repair) this.repairCalls += 1;
    else this.primaryCalls += 1;
    const diagnostic = routerDiagnostic(
      null,
      phase,
      requestedModel,
      requestedEffort,
      this.apiKey,
    );
    this.diagnostics.push(diagnostic);
    const boundedSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(API_LIMITS.requestTimeoutMs),
    ]);
    try {
      const response = await this.fetcher(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + this.apiKey,
            "Content-Type": "application/json",
            "X-OpenRouter-Metadata": "enabled",
          },
          redirect: "error",
          signal: boundedSignal,
          body: JSON.stringify({
            model: requestedModel,
            stream: false,
            provider: { require_parameters: true, allow_fallbacks: false },
            ...body,
            reasoning: { effort: requestedEffort, exclude: true },
          }),
        },
      );
      diagnostic.http_status = response.status;
      if (!response.ok) {
        let value: unknown = null;
        try {
          value = await readResponseJson(response, API_LIMITS.responseBytes);
        } catch {
          await response.body?.cancel().catch(() => {});
        }
        Object.assign(
          diagnostic,
          routerDiagnostic(
            value,
            phase,
            requestedModel,
            requestedEffort,
            this.apiKey,
            response.status,
          ),
        );
        throw providerHttpError(response.status);
      }
      const value = await readResponseJson(response, API_LIMITS.responseBytes);
      Object.assign(
        diagnostic,
        routerDiagnostic(
          value,
          phase,
          requestedModel,
          requestedEffort,
          this.apiKey,
          response.status,
        ),
      );
      if (signal.aborted) throw new IngestionError("run_cancelled");
      if (boundedSignal.aborted)
        throw new IngestionError("provider_request_timeout");
      return parseRouterResponse(value);
    } catch (error) {
      if (signal.aborted) throw new IngestionError("run_cancelled");
      if (boundedSignal.aborted)
        throw new IngestionError("provider_request_timeout");
      if (error instanceof IngestionError) throw error;
      throw new IngestionError("provider_request_failed");
    }
  }

  private verifyResearchSearch(
    response: RouterResponse,
    budget = 3,
  ): ProviderDiagnostic {
    const diagnostic = this.diagnostics.at(-1)!;
    const searches = response.usage?.server_tool_use?.web_search_requests;
    if (searches != null) {
      if (searches === 0) throw new IngestionError("search_not_performed");
      if (searches > this.searchBudget)
        throw new IngestionError("search_tool_limit_exceeded");
      diagnostic.search_verification = "usage_counter";
      return diagnostic;
    }
    const citations = (response.choices[0].message.annotations ?? []).filter(
      (annotation) =>
        annotation.type === "url_citation" && annotation.url_citation,
    );
    if (citations.length === 0)
      throw new IngestionError("search_usage_missing");
    if (citations.length > budget * API_LIMITS.searchResultsPerCall)
      throw new IngestionError("search_result_limit_exceeded");
    if (
      !citations.some((citation) => sourceIdentity(citation.url_citation!.url))
    )
      throw new IngestionError("invalid_search_citation");
    diagnostic.search_verification = "bounded_citations";
    return diagnostic;
  }

  private verifyExtractionFetch(
    response: RouterResponse,
    expected: number,
    completeSourceCoverage: boolean,
    diagnostic = this.diagnostics.at(-1)!,
  ): ProviderDiagnostic {
    const searches = response.usage?.server_tool_use?.web_search_requests;
    if (searches != null && searches !== 0)
      throw new IngestionError("unexpected_extraction_search");
    const fetches = response.usage?.server_tool_use?.web_fetch_requests;
    if (fetches == null) {
      if (!completeSourceCoverage)
        throw new IngestionError("source_fetch_usage_missing");
      diagnostic.fetch_verification = "required_tool_and_source_coverage";
      return diagnostic;
    }
    if (fetches < expected) throw new IngestionError("source_fetch_incomplete");
    if (fetches > expected || fetches > API_LIMITS.fetchToolCalls)
      throw new IngestionError("source_fetch_limit_exceeded");
    diagnostic.fetch_verification = "usage_counter";
    return diagnostic;
  }

  private verifyRepairUsedNoTools(response: RouterResponse): void {
    const diagnostic = this.diagnostics.at(-1)!;
    const tools = response.usage?.server_tool_use;
    if (
      (tools?.web_search_requests ?? 0) !== 0 ||
      (tools?.web_fetch_requests ?? 0) !== 0
    ) {
      diagnostic.repair_validation = "unexpected_tool_use";
      throw new IngestionError("unexpected_repair_tools");
    }
  }

  private async repairCandidates(
    content: string,
    original: RepairOriginals,
    sources: SourceIdentity[],
    signal: AbortSignal,
    profile?: string,
  ): Promise<{
    candidates: unknown[];
    metadata: Record<string, Json>;
    applied: boolean;
  }> {
    if (content.length > API_LIMITS.repairInputCharacters)
      throw new IngestionError("repair_input_too_large");
    const response = await this.request(
      "repair",
      {
        messages: [
          {
            role: "system",
            content:
              (profile === "career"
                ? CAREER_REPAIR_INSTRUCTIONS
                : REPAIR_INSTRUCTIONS) +
              " Required schema: " +
              JSON.stringify(
                candidateResponseFormat(sources.length, profile).json_schema
                  .schema,
              ),
          },
          { role: "user", content: repairInput(content, sources) },
        ],
        max_tokens: API_LIMITS.repairOutputTokens,
        response_format: candidateResponseFormat(sources.length, profile),
      },
      signal,
      this.repairModel,
      this.repairEffort,
    );
    this.verifyRepairUsedNoTools(response);
    const diagnostic = this.diagnostics.at(-1)!;
    let parsed: unknown;
    try {
      parsed = parseStructuredContent(
        response.choices[0].message.content,
        diagnostic,
        "invalid_repair_json",
      );
    } catch {
      diagnostic.repair_validation = "invalid_json";
      throw new IngestionError("invalid_repair_json");
    }
    // Repair output is never passed through legacy adapters: every usable
    // sibling must independently satisfy the current canonical contract.
    const candidates = extractionCandidates(parsed, diagnostic, true, false);
    const coverage = candidates
      ? inspectSourceCoverage(candidates, sources, diagnostic)
      : null;
    if (!candidates) {
      diagnostic.repair_validation = "invalid_shape";
      throw new IngestionError("invalid_repair_output");
    }
    if (!diagnostic.extraction_schema_valid_count) {
      diagnostic.repair_validation = "invalid_format";
      throw new IngestionError("invalid_repair_output");
    }
    if (!coverage?.exact) {
      diagnostic.repair_validation = "invalid_coverage";
      throw new IngestionError("invalid_repair_output");
    }
    const scalarCheck = isolateFactPreservingRepairs(original, candidates);
    diagnostic.repair_scalar_mismatch_count = scalarCheck.mismatchCount;
    diagnostic.repair_scalar_mismatch_paths = scalarCheck.mismatchPaths;
    if (!scalarCheck.candidates || !scalarCheck.usableCandidateCount) {
      diagnostic.repair_validation = "scalar_preservation_failed";
      throw new IngestionError("invalid_repair_output");
    }
    const applied = scalarCheck.appliedCandidateCount > 0;
    diagnostic.repair_validation =
      coverage.complete && scalarCheck.mismatchCount === 0
        ? "accepted"
        : applied
          ? "accepted_partial"
          : "scalar_preservation_failed";
    return {
      candidates: scalarCheck.candidates,
      metadata: routerMetadata(
        response,
        this.repairModel,
        this.repairEffort,
        diagnostic,
      ) as Record<string, Json>,
      applied,
    };
  }

  async research(
    options: SearchOptions,
    signal: AbortSignal,
    excludedSourceUrls: string[] = [],
  ): Promise<Research> {
    validateSearchOptions(options);
    if (options.profile === "career" && !options.career_target)
      throw new IngestionError("invalid_career_config");
    this.searchBudget = options.searches ?? 3;
    const safeExcludedSourceUrls = selectSources(
      excludedSourceUrls,
      API_LIMITS.researchExcludedSources,
    ).map((source) => source.source_url);
    const response = await this.request(
      "research",
      {
        messages: [
          {
            role: "system",
            content:
              options.profile === "career"
                ? CAREER_RESEARCH_INSTRUCTIONS
                : RESEARCH_INSTRUCTIONS,
          },
          {
            role: "user",
            content: researchInput(options, safeExcludedSourceUrls),
          },
        ],
        tools: [
          {
            type: "openrouter:web_search",
            parameters: {
              engine: "exa",
              mode: "auto",
              max_uses: this.searchBudget,
              max_results: API_LIMITS.searchResultsPerCall,
              max_total_results:
                this.searchBudget * API_LIMITS.searchResultsPerCall,
              max_characters: API_LIMITS.searchResultCharacters,
              allowed_domains: ALLOWED_DOMAINS,
            },
          },
        ],
        tool_choice: "required",
        max_tool_calls: this.searchBudget,
        max_tokens: API_LIMITS.researchOutputTokens,
      },
      signal,
    );
    const message = response.choices[0].message;
    const report = message.content;
    if (!report?.trim() || report.length > API_LIMITS.reportCharacters)
      throw new IngestionError("invalid_research_report");
    const diagnostic = this.verifyResearchSearch(response, this.searchBudget);
    const selection = researchSelection(report, options.limit);
    const urls = reportedSourceUrls(response, selection.urls);
    const retrievalUrls: Record<string, string> = {};
    for (const match of report.matchAll(/https:\/\/[^\s)\]}>'"]+/g)) {
      const raw = match[0].replace(/[.,;:!?]+$/, "");
      const source = sourceIdentity(raw);
      if (
        source &&
        urls.includes(source.source_url) &&
        !retrievalUrls[source.source_url]
      ) {
        try {
          retrievalUrls[source.source_url] = sourceRetrievalUrl(raw, source);
        } catch {
          /* Keep identity, never guess a retrieval alias. */
        }
      }
    }
    return {
      report,
      urls,
      retrieval_urls: retrievalUrls,
      metadata: {
        ...(routerMetadata(
          response,
          this.model,
          this.effort,
          diagnostic,
        ) as Record<string, Json>),
        profile: options.profile ?? "founder",
        intent: options.intent ?? "refresh",
        ...(options.profile === "career"
          ? { search_focus: options.search_focus ?? "balanced" }
          : {}),
        planned_queries:
          options.profile === "career" ? careerSearchPlan(options) : [],
        executed_queries: null,
        selection_format: selection.format,
        rejected_listing_count: selection.rejectedCount,
        verification_lead_count: selection.verificationCount,
      },
    };
  }

  async extract(
    research: Research,
    sources: SourceIdentity[],
    options: SearchOptions,
    signal: AbortSignal,
  ): Promise<Extraction> {
    validateSearchOptions(options);
    if (options.profile === "career" && !options.career_target)
      throw new IngestionError("invalid_career_config");
    this.searchBudget = options.searches ?? 3;
    const captured = research.source_pages !== undefined;
    if (captured)
      research = {
        ...research,
        source_pages: validateCapturedPages(research.source_pages, sources),
      };
    const response = await this.request(
      "extraction",
      {
        messages: [
          {
            role: "system",
            content:
              (captured
                ? options.profile === "career"
                  ? CAPTURED_CAREER_EXTRACTION_INSTRUCTIONS
                  : CAPTURED_EXTRACTION_INSTRUCTIONS
                : options.profile === "career"
                  ? CAREER_EXTRACTION_INSTRUCTIONS
                  : EXTRACTION_INSTRUCTIONS) +
              " Required schema: " +
              JSON.stringify(
                candidateResponseFormat(sources.length, options.profile)
                  .json_schema.schema,
              ),
          },
          {
            role: "user",
            content: extractionInput(research, sources, options),
          },
        ],
        ...(captured
          ? {}
          : {
              tools: [
                {
                  type: "openrouter:web_fetch",
                  parameters: {
                    engine: "openrouter",
                    max_uses: sources.length,
                    max_content_tokens: API_LIMITS.fetchContentTokens,
                    allowed_domains: ALLOWED_DOMAINS,
                  },
                },
              ],
              tool_choice: "required",
              max_tool_calls: sources.length,
            }),
        max_tokens: API_LIMITS.extractionOutputTokens,
        response_format: candidateResponseFormat(
          sources.length,
          options.profile,
        ),
      },
      signal,
    );
    const responseDiagnostic = this.diagnostics.at(-1)!;
    if (captured) {
      this.verifyCapturedExtractionTools(response);
      responseDiagnostic.fetch_verification = "local_source_capture";
    }
    const parsed = parseStructuredContent(
      response.choices[0].message.content,
      responseDiagnostic,
      "invalid_extraction_json",
    );
    let candidates = extractionCandidates(parsed, responseDiagnostic);
    let sourceCoverage = candidates
      ? inspectSourceCoverage(candidates, sources, responseDiagnostic)
      : null;
    const reportedTools = response.usage?.server_tool_use;
    if (
      !captured &&
      ((reportedTools?.web_search_requests ?? 0) !== 0 ||
        reportedTools?.web_fetch_requests != null)
    ) {
      this.verifyExtractionFetch(
        response,
        sources.length,
        sourceCoverage?.complete ?? false,
        responseDiagnostic,
      );
    }
    let repairMetadata: Record<string, Json> | null = null;
    let repairApplied = false;
    const repairOriginals = candidates
      ? candidateRepairOriginals(candidates, sources, responseDiagnostic)
      : sourceScopedRepairOriginals(parsed, sources);
    if (!sourceCoverage?.complete && repairOriginals) {
      try {
        const repaired = await this.repairCandidates(
          response.choices[0].message.content ?? "",
          repairOriginals,
          sources,
          signal,
          options.profile,
        );
        candidates = repaired.candidates;
        repairMetadata = repaired.metadata;
        repairApplied = repaired.applied;
        sourceCoverage = inspectSourceCoverage(
          candidates,
          sources,
          repairApplied ? this.diagnostics.at(-1)! : responseDiagnostic,
        );
      } catch (error) {
        const code = errorCode(error);
        // A structural repair failure must not discard a valid original sibling.
        // Authentication, quota and infrastructure errors still stop the run.
        if (
          !candidates?.some(
            (item) => schemaForProfile(options.profile).safeParse(item).success,
          ) ||
          !["invalid_repair_output", "invalid_repair_json"].includes(code)
        )
          throw error;
        repairMetadata = { error_code: code };
      }
    }
    // Preserve per-candidate validation so one malformed sibling cannot erase good evidence.
    if (!candidates || candidates.length !== sources.length)
      throw new IngestionError("invalid_extraction_shape");
    const verifiedDiagnostic = captured
      ? responseDiagnostic
      : this.verifyExtractionFetch(
          response,
          sources.length,
          sourceCoverage?.exact ?? false,
          responseDiagnostic,
        );
    const metadata = routerMetadata(
      response,
      this.model,
      this.effort,
      verifiedDiagnostic,
    ) as Record<string, Json>;
    return {
      candidates,
      metadata: repairMetadata
        ? {
            ...metadata,
            repair_attempted: true,
            repair_applied: repairApplied,
            repair: repairMetadata,
          }
        : metadata,
    };
  }

  private verifyCapturedExtractionTools(response: RouterResponse): void {
    const tools = response.usage?.server_tool_use;
    if (
      (tools?.web_search_requests ?? 0) !== 0 ||
      (tools?.web_fetch_requests ?? 0) !== 0
    )
      throw new IngestionError("unexpected_extraction_tools");
  }
}
