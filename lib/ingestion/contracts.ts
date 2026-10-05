import { z } from "zod";
import type { Database, Json } from "../database.types.ts";

export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

// Quotes anchor facts to source-page text or historical research evidence.
// Textual grounding is not factual verification, so ingestion only creates drafts.
export const textFact = z
  .object({
    value: z.string().nullable(),
    quote: z.string().nullable(),
  })
  .strict();
export const EVENT_FORMATS = ["in-person", "hybrid", "virtual"] as const;
// Gateway outputs are canonical. Runtime inputs retain compatibility with old
// string-valued records, with eligibility and narrow alias handling in normalization.
export const eventFormatOutputFact = textFact.extend({
  value: z.enum(EVENT_FORMATS).nullable(),
});
const priceFact = z
  .object({
    value: z.number().int().min(0).max(2147483647).nullable(),
    quote: z.string().nullable(),
  })
  .strict();
const relevantFact = z
  .object({
    // A selected event is either explicitly relevant or rejected. `false` is
    // not a usable event fact and must not survive structured extraction.
    value: z.literal(true).nullable(),
    quote: z.string().nullable(),
  })
  .strict();
export const sourceVerification = z
  .object({
    status: z.enum(["verified", "rejected"]),
    reason: z
      .enum([
        "source_fetch_failed",
        "source_not_event_listing",
        "source_page_conflict",
        "source_page_past",
        "source_page_cancelled",
        "source_page_virtual_only",
        "source_evidence_insufficient",
      ])
      .nullable(),
  })
  .strict();

export const candidateBaseSchema = z
  .object({
    source_url: z.string(),
    source_verification: sourceVerification,
    relevant_to_founders: relevantFact,
    title: textFact,
    organizer_name: textFact,
    starts_at: textFact,
    ends_at: textFact,
    time_zone: textFact,
    venue_name: textFact,
    address_line: textFact,
    city: textFact,
    region: textFact,
    country_code: textFact,
    event_format: textFact,
    price_amount_cents: priceFact,
    currency_code: textFact,
    registration_status: textFact,
  })
  .strict();

export const candidateSchema = candidateBaseSchema.superRefine(
  (candidate, context) => {
    const facts: Array<{ value: unknown; quote: string | null }> = [
      candidate.relevant_to_founders,
      candidate.title,
      candidate.organizer_name,
      candidate.starts_at,
      candidate.ends_at,
      candidate.time_zone,
      candidate.venue_name,
      candidate.address_line,
      candidate.city,
      candidate.region,
      candidate.country_code,
      candidate.event_format,
      candidate.price_amount_cents,
      candidate.currency_code,
      candidate.registration_status,
    ];
    const rejected = candidate.source_verification.status === "rejected";
    if (
      rejected
        ? candidate.source_verification.reason === null
        : candidate.source_verification.reason !== null
    )
      context.addIssue({
        code: "custom",
        path: ["source_verification", "reason"],
        message: "inconsistent source verification verdict",
      });
    if (
      rejected &&
      facts.some((fact) => fact.value !== null || fact.quote !== null)
    )
      context.addIssue({
        code: "custom",
        path: ["source_verification", "status"],
        message: "rejected facts",
      });
    if (
      !rejected &&
      (candidate.relevant_to_founders.value !== true ||
        !candidate.relevant_to_founders.quote?.trim())
    )
      context.addIssue({
        code: "custom",
        path: ["relevant_to_founders", "quote"],
        message: "missing relevance",
      });
  },
);

export type Candidate = z.infer<typeof candidateSchema>;
export type EventDraft = Pick<
  Database["public"]["Tables"]["events"]["Insert"],
  | "title"
  | "organizer_name"
  | "starts_at"
  | "ends_at"
  | "time_zone"
  | "venue_name"
  | "address_line"
  | "city"
  | "region"
  | "country_code"
  | "event_format"
  | "price_amount_cents"
  | "currency_code"
  | "registration_status"
> & { career_assessment?: Json | null; normalization_notes?: Json };

export type SearchOptions = {
  from: string;
  to: string;
  limit: number;
  profile?: "founder" | "career";
  searches?: number;
  intent?: "refresh" | "expand";
  search_focus?: "balanced" | "product";
  career_target?: import("../career/profile.ts").CareerTarget;
};

export type SourceIdentity = {
  source_name: string;
  source_url: string;
  external_id: string | null;
};

export type Research = {
  report: string;
  urls: string[];
  metadata: Json;
  retrieval_urls?: Record<string, string>;
  source_pages?: import("./source-page.ts").CapturedSourcePage[];
};

export type Extraction = {
  candidates: unknown[];
  metadata: Json;
};

export type StructuredOutputDiagnostic = {
  parse_status: "valid" | "invalid";
  format:
    | "json_object"
    | "json_array"
    | "json_scalar"
    | "missing"
    | "empty"
    | "single_code_fence"
    | "mixed_text"
    | "object_like"
    | "array_like"
    | "text";
  fence_language: "json" | "unlabelled" | "other" | null;
  fence_json_valid: boolean | null;
  structure_incomplete: boolean | null;
  leading_bom: boolean;
  inspection_truncated: boolean;
};

export type ProviderDiagnostic = {
  phase: "research" | "extraction" | "repair";
  requested_model: string | null;
  requested_effort: ReasoningEffort | null;
  response_id: string | null;
  model: string | null;
  http_status: number | null;
  access_denial:
    | "guardrail"
    | "data_policy"
    | "geographic_restriction"
    | "model_access"
    | "account_access"
    | "unknown"
    | null;
  router_attempt: number | null;
  router_endpoint_total: number | null;
  router_endpoint_available_count: number | null;
  router_endpoint_selected_count: number | null;
  router_guardrail_stage_count: number | null;
  finish_reason: string | null;
  search_usage: "missing" | "invalid" | "reported";
  search_tool_calls: number | null;
  search_verification?: "usage_counter" | "bounded_citations";
  fetch_usage: "missing" | "invalid" | "reported";
  fetch_tool_calls: number | null;
  fetch_verification?:
    | "usage_counter"
    | "required_tool_and_source_coverage"
    | "local_source_capture";
  extraction_shape:
    | "candidates_object"
    | "schema_named_object"
    | "candidate_array"
    | "encoded_candidate_envelope"
    | "invalid"
    | null;
  extraction_candidate_count: number | null;
  extraction_schema_valid_count: number | null;
  extraction_source_match_count: number | null;
  extraction_duplicate_source_count: number | null;
  extraction_untrusted_source_count: number | null;
  extraction_candidate_format:
    "canonical" | "legacy_flat" | "legacy_nested" | "mixed" | "invalid" | null;
  repair_scalar_mismatch_count: number | null;
  repair_scalar_mismatch_paths: string[] | null;
  repair_validation:
    | "accepted"
    | "accepted_partial"
    | "invalid_json"
    | "invalid_shape"
    | "invalid_format"
    | "invalid_coverage"
    | "scalar_preservation_failed"
    | "unexpected_tool_use"
    | null;
  citation_count: number | null;
  tool_call_count: number | null;
  content_characters: number | null;
  structured_output?: StructuredOutputDiagnostic | null;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    reasoning_tokens: number | null;
    total_tokens: number | null;
    cost: number | null;
  };
};

export interface DiscoveryProvider {
  getDiagnostics?(): ProviderDiagnostic[];
  research(
    options: SearchOptions,
    signal: AbortSignal,
    excludedSourceUrls?: string[],
  ): Promise<Research>;
  extract(
    research: Research,
    sources: SourceIdentity[],
    options: SearchOptions,
    signal: AbortSignal,
  ): Promise<Extraction>;
}

export type Observation = SourceIdentity & {
  content_text?: string;
  content_hash?: string;
  raw_payload?: Json;
  error_code?: string;
};

export type SaveResult = {
  source_id: string;
  event_id: string | null;
  source_created: boolean;
  event_written: boolean;
};

export type RunSummary = {
  run_id: string;
  status: "running" | "succeeded" | "partial" | "failed" | "cancelled";
  sources_discovered: number;
  sources_created: number;
  sources_updated: number;
  events_written: number;
  sources_unlinked: number;
  errors: string[];
  provider_diagnostics?: ProviderDiagnostic[];
  candidate_validation_failures?: CandidateValidationFailure[];
  source_capture_diagnostics?: import("./source-page.ts").SourceCaptureDiagnostic[];
  discovery_exclusions?: import("./exclusions.ts").DiscoveryExclusionSummary;
};

export type CandidateValidationFailure = {
  source_id: string;
  error_code: string;
  fields: Array<{ path: string; reason: string }>;
  truncated: boolean;
};

export interface IngestionRepository {
  start(options: SearchOptions): Promise<string>;
  listRecentCancelledSourceUrls(
    since: string,
    limit: number,
  ): Promise<string[]>;
  listLinkedSourceUrls(
    from: string,
    to: string,
    limit: number,
  ): Promise<string[]>;
  checkpoint(runId: string, metadata: Json): Promise<void>;
  save(
    runId: string,
    source: Observation,
    event: EventDraft | null,
    observedAt: string,
  ): Promise<SaveResult>;
  finish(summary: RunSummary, metadata: Json): Promise<void>;
}
