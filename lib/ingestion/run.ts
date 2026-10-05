import "server-only";
import { createHash } from "node:crypto";
import type { Json } from "../database.types.ts";
import type {
  DiscoveryProvider,
  EventDraft,
  IngestionRepository,
  Research,
  RunSummary,
  SaveResult,
  SearchOptions,
  SourceIdentity,
} from "./contracts.ts";
import { IngestionError, errorCode } from "./errors.ts";
import { normalizeCandidate } from "./normalize.ts";
import { schemaForProfile } from "../career/contracts.ts";
import { careerSearchPlan } from "../career/profile.ts";
import { careerSourceEvidence } from "../career/evidence.ts";
import { validationFailure } from "./candidate-validation.ts";
import { privateCandidateFailure } from "./private-candidate-failure.ts";
import { validateSearchOptions } from "./options.ts";
import {
  CAPTURE_ERROR_CODES,
  SOURCE_CAPTURE_LIMITS,
  validateCapturedPages,
} from "./source-page.ts";
import type {
  CapturedSourcePage,
  SourceCaptureDiagnostic,
} from "./source-page.ts";
import {
  captureFailureDetails,
  capturedPageDiagnostic,
} from "./source-capture.ts";
import { selectSources, sourceIdentity } from "./sources.ts";
import { collectDiscoveryExclusions } from "./exclusions.ts";

type Dependencies = {
  provider: DiscoveryProvider;
  repository: IngestionRepository;
  signal: AbortSignal;
  now?: () => Date;
  onProgress?: (summary: RunSummary) => Promise<void>;
  captureSource?: (
    source: SourceIdentity,
    retrievalUrl: string,
    signal: AbortSignal,
  ) => Promise<CapturedSourcePage>;
};
type PersistedSource = {
  source: SourceIdentity;
  eventId: string | null;
  sourceId: string;
};
type RunContext = {
  summary: RunSummary;
  metadata: Record<string, Json>;
  options: SearchOptions;
  observedAt: string;
};

function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) throw new IngestionError("run_cancelled");
}

function addError(summary: RunSummary, code: string): void {
  if (!summary.errors.includes(code)) summary.errors.push(code);
}

function failureStatus(
  summary: RunSummary,
  signal: AbortSignal,
): RunSummary["status"] {
  if (signal.aborted) return "cancelled";
  return summary.sources_created + summary.sources_updated > 0
    ? "partial"
    : "failed";
}

async function reportProgress(
  summary: RunSummary,
  deps: Dependencies,
): Promise<void> {
  try {
    const diagnostics = deps.provider.getDiagnostics?.();
    if (diagnostics?.length) summary.provider_diagnostics = diagnostics;
  } catch {
    addError(summary, "provider_diagnostics_unavailable");
  }
  try {
    await deps.onProgress?.(structuredClone(summary));
  } catch {
    addError(summary, "progress_write_failed");
  }
}

function indexCandidates(
  candidates: unknown[],
  sources: SourceIdentity[],
  summary: RunSummary,
): Map<string, unknown[]> {
  const allowed = new Set(sources.map((source) => source.source_url));
  const result = new Map<string, unknown[]>();
  for (const item of candidates) {
    const url =
      item &&
      typeof item === "object" &&
      "source_url" in item &&
      typeof item.source_url === "string"
        ? sourceIdentity(item.source_url)?.source_url
        : null;
    if (!url || !allowed.has(url)) {
      addError(summary, "untrusted_candidate_url");
      continue;
    }
    result.set(url, [...(result.get(url) ?? []), item]);
  }
  return result;
}

async function saveExtractedSource(
  source: SourceIdentity,
  sourceId: string,
  candidates: unknown[],
  research: Research,
  context: RunContext,
  repository: IngestionRepository,
): Promise<SaveResult> {
  let event: EventDraft;
  let evidence = research.report;
  const page = research.source_pages?.find(
    (item) => item.source_url === source.source_url,
  );
  try {
    if (candidates.length !== 1)
      throw new IngestionError(
        candidates.length ? "duplicate_candidate" : "candidate_missing",
      );
    if (research.source_pages) {
      if (!page) throw new IngestionError("invalid_source_evidence");
      evidence = page.text;
    } else if (context.options.profile === "career")
      evidence = careerSourceEvidence(
        research.report,
        source.source_url,
        context.summary.sources_discovered,
      );
    event = normalizeCandidate(
      candidates[0],
      source,
      evidence,
      context.options,
      context.observedAt,
    );
  } catch (error) {
    const code = errorCode(error);
    addError(context.summary, code);
    const failures = context.metadata.candidate_failures;
    const snapshots = Array.isArray(failures) ? failures : [];
    if (snapshots.length < 10) {
      snapshots.push(
        privateCandidateFailure(sourceId, code, context.observedAt, candidates),
      );
      context.metadata.candidate_failures = snapshots;
    }
    if (candidates.length === 1 && code === "invalid_candidate") {
      context.summary.candidate_validation_failures ??= [];
      context.summary.candidate_validation_failures.push(
        validationFailure(
          sourceId,
          code,
          candidates[0],
          schemaForProfile(context.options.profile),
        ),
      );
    }
    return repository.save(
      context.summary.run_id,
      { ...source, error_code: code },
      null,
      context.observedAt,
    );
  }
  return repository.save(
    context.summary.run_id,
    {
      ...source,
      content_text: evidence,
      content_hash: createHash("sha256").update(evidence).digest("hex"),
      raw_payload: {
        evidence_kind: page
          ? "source_page_text_v1"
          : "model_web_search_report_with_source_fetch",
        ...(page
          ? { source_page: JSON.parse(JSON.stringify(page)) as Json }
          : {}),
        research: research.metadata,
        extraction: context.metadata.extraction ?? null,
        candidate: JSON.parse(JSON.stringify(candidates[0])) as Json,
        normalization_notes: event.normalization_notes ?? [],
      },
    },
    event,
    context.observedAt,
  );
}

async function persistDiscovery(
  sources: SourceIdentity[],
  context: RunContext,
  deps: Dependencies,
): Promise<PersistedSource[]> {
  const persisted: PersistedSource[] = [];
  for (const source of sources) {
    checkCancellation(deps.signal);
    try {
      const saved = await deps.repository.save(
        context.summary.run_id,
        source,
        null,
        context.observedAt,
      );
      if (saved.source_created) context.summary.sources_created += 1;
      else context.summary.sources_updated += 1;
      if (!saved.event_id) context.summary.sources_unlinked += 1;
      persisted.push({
        source,
        eventId: saved.event_id,
        sourceId: saved.source_id,
      });
    } catch (error) {
      addError(context.summary, errorCode(error));
    }
  }
  return persisted;
}

async function extractCandidates(
  sources: SourceIdentity[],
  research: Research,
  context: RunContext,
  deps: Dependencies,
): Promise<unknown[]> {
  try {
    const extracted = await deps.provider.extract(
      research,
      sources,
      context.options,
      deps.signal,
    );
    context.metadata.extraction = extracted.metadata;
    return extracted.candidates;
  } catch (error) {
    const code = errorCode(error);
    // Preserve previous good snapshots; record only safe failure codes.
    for (const source of sources) {
      try {
        await deps.repository.save(
          context.summary.run_id,
          { ...source, error_code: code },
          null,
          context.observedAt,
        );
      } catch (saveError) {
        addError(context.summary, errorCode(saveError));
      }
    }
    throw error;
  }
}

async function processCandidates(
  persisted: PersistedSource[],
  research: Research,
  context: RunContext,
  deps: Dependencies,
): Promise<void> {
  checkCancellation(deps.signal);
  const sources = persisted.map((item) => item.source);
  const candidates = await extractCandidates(sources, research, context, deps);
  if (research.source_pages) {
    context.observedAt = (deps.now ?? (() => new Date()))().toISOString();
    context.metadata.evidence_observed_at = context.observedAt;
  }
  const indexed = indexCandidates(candidates, sources, context.summary);
  for (const { source, eventId, sourceId } of persisted) {
    checkCancellation(deps.signal);
    try {
      const saved = await saveExtractedSource(
        source,
        sourceId,
        indexed.get(source.source_url) ?? [],
        research,
        context,
        deps.repository,
      );
      if (saved.event_written) context.summary.events_written += 1;
      if (!eventId && saved.event_id) context.summary.sources_unlinked -= 1;
    } catch (error) {
      addError(context.summary, errorCode(error));
    }
    context.metadata.summary = { ...context.summary };
    await deps.repository.checkpoint(context.summary.run_id, context.metadata);
    await reportProgress(context.summary, deps);
  }
}

/** Capture independently; persist failures without replacing previous good evidence. */
async function captureEvidence(
  persisted: PersistedSource[],
  research: Research,
  context: RunContext,
  deps: Dependencies,
): Promise<{ persisted: PersistedSource[]; research: Research }> {
  if (!deps.captureSource) return { persisted, research };
  const accepted: PersistedSource[] = [];
  const pages: CapturedSourcePage[] = [];
  const diagnostics: SourceCaptureDiagnostic[] = [];
  context.metadata.evidence_kind = "source_page_text_v1";
  for (const item of persisted) {
    checkCancellation(deps.signal);
    try {
      const page = await deps.captureSource(
        item.source,
        research.retrieval_urls?.[item.source.source_url] ??
          item.source.source_url,
        deps.signal,
      );
      checkCancellation(deps.signal);
      if (
        pages.reduce(
          (sum, entry) => sum + entry.text.length,
          page.text.length,
        ) > SOURCE_CAPTURE_LIMITS.totalTextCharacters
      )
        throw new IngestionError("source_capture_too_large");
      validateCapturedPages(
        [...pages, page],
        [...accepted, item].map((entry) => entry.source),
      );
      pages.push(page);
      accepted.push(item);
      diagnostics.push({
        source_id: item.sourceId,
        ...capturedPageDiagnostic(page),
      });
    } catch (error) {
      checkCancellation(deps.signal);
      const code = errorCode(error);
      const safeCode =
        CAPTURE_ERROR_CODES.find((entry) => entry === code) ??
        "source_capture_fetch_failed";
      addError(context.summary, safeCode);
      diagnostics.push({
        source_id: item.sourceId,
        status: "failed",
        error_code: safeCode,
        ...captureFailureDetails(error),
      });
      await deps.repository.save(
        context.summary.run_id,
        { ...item.source, error_code: safeCode },
        null,
        context.observedAt,
      );
    }
    context.summary.source_capture_diagnostics = diagnostics;
    context.metadata.source_pages = JSON.parse(JSON.stringify(pages)) as Json;
    context.metadata.summary = JSON.parse(
      JSON.stringify(context.summary),
    ) as Json;
    await deps.repository.checkpoint(context.summary.run_id, context.metadata);
    await reportProgress(context.summary, deps);
  }
  return {
    persisted: accepted,
    research: { ...research, source_pages: pages },
  };
}

async function collectAndPersist(
  context: RunContext,
  deps: Dependencies,
): Promise<void> {
  const exclusionReference = (deps.now ?? (() => new Date()))();
  const exclusions = await collectDiscoveryExclusions(
    context.options,
    deps.repository,
    exclusionReference,
  );
  checkCancellation(deps.signal);
  const excludedSourceUrls = exclusions.urls;
  context.summary.discovery_exclusions = exclusions.summary;
  context.metadata.discovery_exclusions = { ...exclusions.summary };
  context.metadata.excluded_source_count = excludedSourceUrls.length;
  context.metadata.excluded_source_urls = excludedSourceUrls;
  context.metadata.summary = { ...context.summary };
  await deps.repository.checkpoint(context.summary.run_id, context.metadata);
  checkCancellation(deps.signal);
  const research = await deps.provider.research(
    context.options,
    deps.signal,
    excludedSourceUrls,
  );
  checkCancellation(deps.signal);
  context.observedAt = (deps.now ?? (() => new Date()))().toISOString();
  const sources = selectSources(
    research.urls,
    context.options.limit,
    excludedSourceUrls,
  );
  context.summary.sources_discovered = sources.length;
  Object.assign(context.metadata, {
    research: research.metadata,
    research_report: research.report,
    consulted_urls: sources.map((source) => source.source_url),
    ...(research.retrieval_urls
      ? { retrieval_urls: research.retrieval_urls }
      : {}),
  });
  await deps.repository.checkpoint(context.summary.run_id, context.metadata);
  const persisted = await persistDiscovery(sources, context, deps);
  context.metadata.summary = { ...context.summary };
  await deps.repository.checkpoint(context.summary.run_id, context.metadata);
  await reportProgress(context.summary, deps);
  if (persisted.length) {
    const captured = await captureEvidence(persisted, research, context, deps);
    if (captured.persisted.length)
      await processCandidates(
        captured.persisted,
        captured.research,
        context,
        deps,
      );
  }
}

/** One bounded run: checkpoint research first, then save independent sources. */
export async function runIngestion(
  input: SearchOptions,
  deps: Dependencies,
): Promise<RunSummary> {
  const options = validateSearchOptions(input);
  if (options.profile === "career" && !options.career_target)
    throw new IngestionError("invalid_career_config");
  checkCancellation(deps.signal);
  const summary: RunSummary = {
    run_id: await deps.repository.start(options),
    status: "running",
    sources_discovered: 0,
    sources_created: 0,
    sources_updated: 0,
    events_written: 0,
    sources_unlinked: 0,
    errors: [],
  };
  const context: RunContext = {
    summary,
    options,
    metadata: {
      evidence_kind: "model_web_search_report_with_source_fetch",
      profile: options.profile ?? "founder",
      intent: options.intent ?? "refresh",
      ...(options.profile === "career"
        ? { search_focus: options.search_focus ?? "balanced" }
        : {}),
      profile_version: options.career_target?.version ?? "founder-v1",
      planned_queries:
        options.profile === "career" ? careerSearchPlan(options) : [],
    },
    observedAt: "",
  };
  try {
    await reportProgress(summary, deps);
    await collectAndPersist(context, deps);
    checkCancellation(deps.signal);
    summary.status = summary.errors.length
      ? failureStatus(summary, deps.signal)
      : "succeeded";
  } catch (error) {
    addError(summary, errorCode(error));
    summary.status = failureStatus(summary, deps.signal);
  }
  await reportProgress(summary, deps);
  if (summary.status === "succeeded" && summary.errors.length) {
    summary.status = failureStatus(summary, deps.signal);
  }
  context.metadata.summary = { ...summary };
  try {
    await deps.repository.finish(summary, context.metadata);
  } catch (error) {
    addError(summary, errorCode(error));
    summary.status = failureStatus(summary, deps.signal);
    await reportProgress(summary, deps);
    throw error;
  }
  return summary;
}
