import "server-only";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readDatabaseSelection } from "../storage/config.ts";

const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024;
const MAX_CHECKPOINT_FILES = 500;
const SAFE_CODE = /^[a-z0-9_]{1,64}$/;
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);
const LOSS_CATEGORY_BY_ERROR: Record<string, string> = {
  search_not_performed: "discovery_execution",
  search_usage_missing: "discovery_execution",
  provider_request_failed: "provider_or_transport",
  provider_incomplete: "provider_or_transport",
  provider_authentication_failed: "provider_or_transport",
  provider_access_denied: "provider_or_transport",
  provider_quota_or_rate_limit: "provider_or_transport",
  source_fetch_usage_missing: "source_verification",
  source_fetch_failed: "source_verification",
  source_fetch_incomplete: "source_verification",
  source_fetch_limit_exceeded: "source_verification",
  source_evidence_insufficient: "source_verification",
  source_page_cancelled: "source_verification",
  invalid_extraction_shape: "response_shape",
  invalid_repair_output: "response_shape",
  invalid_candidate: "response_shape",
  irrelevant_event: "eligibility",
  virtual_event: "eligibility",
  wrong_city: "eligibility",
  out_of_range: "eligibility",
  incomplete_event: "event_validation",
  candidate_missing: "event_validation",
  event_already_started: "event_validation",
  run_cancelled: "operator_cancelled",
};

type UnknownRecord = Record<string, unknown>;

export type EvaluationOptions = {
  command: "help" | "run";
  checkpointDirectory: string;
  outputPath: string;
};

export type SafeDiagnostic = {
  phase: "research" | "extraction" | "repair" | null;
  cost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  extractionShape: string | null;
  extractionFormat: string | null;
  repairValidation: string | null;
};

export type SafeRunSummary = {
  runId: string;
  eventsWritten: number;
  sourcesUnlinked: number;
  errors: string[];
  diagnostics: SafeDiagnostic[];
};

export type EvaluationRun = {
  id: string;
  status: string;
  startedAt: string;
  requestedLimit: number | null;
  sourcesDiscovered: number;
  sourcesCreated: number;
  sourcesUpdated: number;
  runErrorCodes: string[];
  summary: SafeRunSummary | null;
};

export type EvaluationInput = {
  runs: EvaluationRun[];
  databaseState: {
    events: number;
    nonfixtureEvents: number;
    sources: number;
    linkedSources: number;
    unlinkedSources: number;
    publicationStatuses: Record<string, number>;
    sourceErrorCounts: Record<string, number>;
    sourcePortfolio: Record<string, SourceFamilyMetrics>;
  };
  checkpoints: {
    filesRead: number;
    invalidFiles: number;
    matchedRuns: number;
    unmatchedRuns: number;
  };
};

export type SourceFamilyMetrics = {
  consultations: number;
  consultationRuns: number;
  storedSources: number;
  linkedSources: number;
  latestErrorSources: number;
};

export const EVALUATION_HELP = `Evaluate local ingestion quality offline:
  DATABASE_BACKEND=sqlite SQLITE_DATABASE_PATH=data/imported-founder-radar.sqlite \\
    npm run ingest:evaluate -- run

Optional paths:
  --checkpoints codex-tmp
  --output codex-tmp/ingestion-quality-report.json

The evaluator opens SQLite read-only, reads only allowlisted run-summary fields, and
never reads credentials, research reports, source content, or raw payloads. It makes
no network requests, paid calls, database writes, publication changes, or retries.`;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
    ? value
    : null;
}

function nonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function safeCategory(value: unknown): string | null {
  return typeof value === "string" && SAFE_CODE.test(value) ? value : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseDiagnostic(value: unknown): SafeDiagnostic | null {
  if (!isRecord(value)) return null;
  const usage = isRecord(value.usage) ? value.usage : {};
  const phase =
    value.phase === "research" ||
    value.phase === "extraction" ||
    value.phase === "repair"
      ? value.phase
      : null;
  return {
    phase,
    cost: nonnegativeNumber(usage.cost),
    inputTokens: nonnegativeInteger(usage.input_tokens),
    outputTokens: nonnegativeInteger(usage.output_tokens),
    reasoningTokens: nonnegativeInteger(usage.reasoning_tokens),
    totalTokens: nonnegativeInteger(usage.total_tokens),
    extractionShape: safeCategory(value.extraction_shape),
    extractionFormat: safeCategory(value.extraction_candidate_format),
    repairValidation: safeCategory(value.repair_validation),
  };
}

/** Parse only aggregate-safe fields from a stored summary or checkpoint. */
export function parseSafeRunSummary(value: unknown): SafeRunSummary | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed) || typeof parsed.run_id !== "string") return null;
  const eventsWritten = nonnegativeInteger(parsed.events_written);
  const sourcesUnlinked = nonnegativeInteger(parsed.sources_unlinked);
  if (eventsWritten === null || sourcesUnlinked === null) return null;
  const errors = Array.isArray(parsed.errors)
    ? parsed.errors
        .map(safeCategory)
        .filter((error): error is string => error !== null)
        .slice(0, 50)
    : [];
  const diagnostics = Array.isArray(parsed.provider_diagnostics)
    ? parsed.provider_diagnostics
        .map(parseDiagnostic)
        .filter((item): item is SafeDiagnostic => item !== null)
        .slice(0, 3)
    : [];
  return {
    runId: parsed.run_id,
    eventsWritten,
    sourcesUnlinked,
    errors,
    diagnostics,
  };
}

function insideCodexTmp(path: string, cwd: string): string {
  const root = resolve(cwd, "codex-tmp");
  const target = resolve(cwd, path);
  const fromRoot = relative(root, target);
  if (
    fromRoot === "" ||
    (!fromRoot.startsWith("..") && !fromRoot.startsWith("/"))
  )
    return target;
  throw new Error("Evaluation artifacts must stay under codex-tmp.");
}

/** Validate all arguments before opening the database or reading checkpoints. */
export function parseEvaluationOptions(
  args: string[],
  cwd = process.cwd(),
): EvaluationOptions {
  if (!args.length || (args.length === 1 && args[0] === "--help"))
    return {
      command: "help",
      checkpointDirectory: resolve(cwd, "codex-tmp"),
      outputPath: resolve(cwd, "codex-tmp/ingestion-quality-report.json"),
    };
  const [command, ...rest] = args;
  if (command !== "run")
    throw new Error("Use ingestion evaluation help or run.");
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index];
    if (!["--checkpoints", "--output"].includes(key) || values.has(key))
      throw new Error("Unknown or repeated evaluation option.");
    const value = rest[++index];
    if (!value || value.startsWith("--"))
      throw new Error("Evaluation option requires a value.");
    values.set(key, value);
  }
  const outputPath = insideCodexTmp(
    values.get("--output") ?? "codex-tmp/ingestion-quality-report.json",
    cwd,
  );
  if (!outputPath.endsWith(".json"))
    throw new Error("Evaluation output must be a JSON file under codex-tmp.");
  return {
    command: "run",
    checkpointDirectory: insideCodexTmp(
      values.get("--checkpoints") ?? "codex-tmp",
      cwd,
    ),
    outputPath,
  };
}

async function loadCheckpoints(directory: string): Promise<{
  summaries: Map<string, SafeRunSummary>;
  filesRead: number;
  invalidFiles: number;
}> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT")
      return { summaries: new Map(), filesRead: 0, invalidFiles: 0 };
    throw error;
  }
  const names = entries
    .filter(
      (entry) =>
        entry.isFile() && /^ingestion-[0-9a-f-]+\.json$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .slice(0, MAX_CHECKPOINT_FILES);
  const summaries = new Map<string, SafeRunSummary>();
  let invalidFiles = 0;
  for (const name of names) {
    const path = resolve(directory, name);
    try {
      const information = await stat(path);
      if (information.size > MAX_CHECKPOINT_BYTES) {
        invalidFiles++;
        continue;
      }
      const summary = parseSafeRunSummary(await readFile(path, "utf8"));
      if (!summary) invalidFiles++;
      else summaries.set(summary.runId, summary);
    } catch {
      invalidFiles++;
    }
  }
  return { summaries, filesRead: names.length, invalidFiles };
}

function numberRecord(
  rows: UnknownRecord[],
  key: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const name = safeCategory(row[key]) ?? "unknown";
    const count = nonnegativeInteger(row.count);
    if (count !== null) result[name] = (result[name] ?? 0) + count;
  }
  return result;
}

function sourcePortfolioRecord(
  rows: UnknownRecord[],
): Record<string, SourceFamilyMetrics> {
  const result: Record<string, SourceFamilyMetrics> = {};
  for (const row of rows) {
    const family = safeCategory(row.family);
    if (!family) continue;
    result[family] = {
      consultations: nonnegativeInteger(row.consultations) ?? 0,
      consultationRuns: nonnegativeInteger(row.consultation_runs) ?? 0,
      storedSources: nonnegativeInteger(row.stored_sources) ?? 0,
      linkedSources: nonnegativeInteger(row.linked_sources) ?? 0,
      latestErrorSources: nonnegativeInteger(row.latest_error_sources) ?? 0,
    };
  }
  return result;
}

function parseRunErrorCodes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((code) => safeCategory(code.trim()))
    .filter((code): code is string => code !== null)
    .slice(0, 50);
}

function mergeSummary(
  stored: SafeRunSummary | null,
  checkpoint: SafeRunSummary | null,
): SafeRunSummary | null {
  if (!stored) return checkpoint;
  if (!checkpoint) return stored;
  return {
    ...stored,
    errors: [...new Set([...stored.errors, ...checkpoint.errors])],
    diagnostics:
      checkpoint.diagnostics.length > stored.diagnostics.length
        ? checkpoint.diagnostics
        : stored.diagnostics,
  };
}

/** Load only bounded aggregates and summary JSON from SQLite in read-only mode. */
export async function loadEvaluationInput(
  databasePath: string,
  checkpointDirectory: string,
): Promise<EvaluationInput> {
  const checkpoints = await loadCheckpoints(checkpointDirectory);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `select id, agent_name, provider, status, started_at, sources_discovered,
         sources_created, sources_updated, error_message,
         json_extract(search_parameters, '$.limit') requested_limit,
         json_extract(metadata, '$.summary') summary_json
         from search_runs
         where agent_name = 'founder-radar-discovery'
           and provider = 'openrouter-web-search'
         order by started_at, id`,
      )
      .all() as UnknownRecord[];
    let matchedRuns = 0;
    const runs = rows.map((row): EvaluationRun => {
      const id = String(row.id);
      const checkpoint = checkpoints.summaries.get(id) ?? null;
      if (checkpoint) matchedRuns++;
      return {
        id,
        status: String(row.status),
        startedAt: String(row.started_at),
        requestedLimit: nonnegativeInteger(row.requested_limit),
        sourcesDiscovered: nonnegativeInteger(row.sources_discovered) ?? 0,
        sourcesCreated: nonnegativeInteger(row.sources_created) ?? 0,
        sourcesUpdated: nonnegativeInteger(row.sources_updated) ?? 0,
        runErrorCodes: parseRunErrorCodes(row.error_message),
        summary: mergeSummary(
          parseSafeRunSummary(row.summary_json),
          checkpoint,
        ),
      };
    });
    const eventCounts = database
      .prepare(
        `select count(*) events,
         sum(case when is_fixture = 0 then 1 else 0 end) nonfixture_events
         from events`,
      )
      .get() as UnknownRecord;
    const sourceCounts = database
      .prepare(
        `select count(*) sources,
         sum(case when event_id is not null then 1 else 0 end) linked_sources,
         sum(case when event_id is null then 1 else 0 end) unlinked_sources
         from event_sources`,
      )
      .get() as UnknownRecord;
    const publicationRows = database
      .prepare(
        "select publication_status status, count(*) count from events group by publication_status",
      )
      .all() as UnknownRecord[];
    const sourceErrorRows = database
      .prepare(
        `select coalesce(last_attempt_error, 'none') error_code, count(*) count
         from event_sources group by last_attempt_error`,
      )
      .all() as UnknownRecord[];
    const sourcePortfolioRows = database
      .prepare(
        `with consulted as (
           select search_runs.id run_id, lower(cast(url.value as text)) url
           from search_runs, json_each(search_runs.metadata, '$.consulted_urls') url
           where search_runs.agent_name = 'founder-radar-discovery'
             and search_runs.provider = 'openrouter-web-search'
             and url.type = 'text'
             and lower(cast(url.value as text)) like 'https://%'
             and lower(cast(url.value as text)) not like 'https://%.example.invalid/%'
         ), classified_consultations as (
           select run_id,
             case
               when url like 'https://meetup.com/%' or url like 'https://www.meetup.com/%' then 'meetup'
               when url like 'https://luma.com/%' or url like 'https://www.luma.com/%' then 'luma'
               when url like 'https://eventbrite.com/%' or url like 'https://www.eventbrite.com/%' then 'eventbrite'
               else 'first_party_or_other'
             end family
           from consulted
         ), classified_sources as (
           select event_id, last_attempt_error,
             case
               when lower(source_url) like 'https://meetup.com/%' or lower(source_url) like 'https://www.meetup.com/%' then 'meetup'
               when lower(source_url) like 'https://luma.com/%' or lower(source_url) like 'https://www.luma.com/%' then 'luma'
               when lower(source_url) like 'https://eventbrite.com/%' or lower(source_url) like 'https://www.eventbrite.com/%' then 'eventbrite'
               else 'first_party_or_other'
             end family
           from event_sources
           where lower(source_url) not like 'https://%.example.invalid/%'
         ), metrics as (
           select family, count(*) consultations, count(distinct run_id) consultation_runs,
             0 stored_sources, 0 linked_sources, 0 latest_error_sources
           from classified_consultations group by family
           union all
           select family, 0, 0, count(*),
             sum(case when event_id is not null then 1 else 0 end),
             sum(case when last_attempt_error is not null then 1 else 0 end)
           from classified_sources group by family
         )
         select family, sum(consultations) consultations,
           sum(consultation_runs) consultation_runs,
           sum(stored_sources) stored_sources,
           sum(linked_sources) linked_sources,
           sum(latest_error_sources) latest_error_sources
         from metrics group by family order by family`,
      )
      .all() as UnknownRecord[];
    return {
      runs,
      databaseState: {
        events: nonnegativeInteger(eventCounts.events) ?? 0,
        nonfixtureEvents:
          nonnegativeInteger(eventCounts.nonfixture_events) ?? 0,
        sources: nonnegativeInteger(sourceCounts.sources) ?? 0,
        linkedSources: nonnegativeInteger(sourceCounts.linked_sources) ?? 0,
        unlinkedSources: nonnegativeInteger(sourceCounts.unlinked_sources) ?? 0,
        publicationStatuses: numberRecord(publicationRows, "status"),
        sourceErrorCounts: numberRecord(sourceErrorRows, "error_code"),
        sourcePortfolio: sourcePortfolioRecord(sourcePortfolioRows),
      },
      checkpoints: {
        filesRead: checkpoints.filesRead,
        invalidFiles: checkpoints.invalidFiles,
        matchedRuns,
        unmatchedRuns: checkpoints.summaries.size - matchedRuns,
      },
    };
  } finally {
    database.close();
  }
}

function increment(counts: Record<string, number>, key: string | null): void {
  counts[key ?? "unknown"] = (counts[key ?? "unknown"] ?? 0) + 1;
}

function lossCategory(error: string): string {
  return LOSS_CATEGORY_BY_ERROR[error] ?? "other_safe_error";
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function money(value: number): number {
  return Number(value.toFixed(8));
}

function dominantCategory(counts: Record<string, number>): string | null {
  return (
    Object.entries(counts).sort(
      ([leftName, leftCount], [rightName, rightCount]) =>
        rightCount - leftCount || leftName.localeCompare(rightName),
    )[0]?.[0] ?? null
  );
}

function summarizeSourcePortfolio(
  portfolio: Record<string, SourceFamilyMetrics>,
): UnknownRecord {
  const familyMetrics: Record<string, UnknownRecord> = {};
  let totalConsultations = 0;
  let marketplaceConsultations = 0;
  for (const [family, metrics] of Object.entries(portfolio).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    totalConsultations += metrics.consultations;
    if (["meetup", "luma", "eventbrite"].includes(family))
      marketplaceConsultations += metrics.consultations;
    familyMetrics[family] = {
      consultations: metrics.consultations,
      consultation_runs: metrics.consultationRuns,
      stored_sources: metrics.storedSources,
      linked_sources: metrics.linkedSources,
      linked_source_rate: ratio(metrics.linkedSources, metrics.storedSources),
      latest_error_sources: metrics.latestErrorSources,
    };
  }
  return {
    total_consultations: totalConsultations,
    marketplace_consultations: marketplaceConsultations,
    marketplace_consultation_share: ratio(
      marketplaceConsultations,
      totalConsultations,
    ),
    family_metrics: familyMetrics,
  };
}

function summarizeCohort(runs: EvaluationRun[]): UnknownRecord {
  const statusCounts: Record<string, number> = {};
  const errorCounts: Record<string, number> = {};
  const lossCategoryCounts: Record<string, number> = {};
  let requestedSlots = 0;
  let discoveredWithinLimit = 0;
  let sourcesDiscovered = 0;
  let usableDraftWrites = 0;
  let repairRuns = 0;
  let diagnosticCoveredRuns = 0;
  for (const run of runs) {
    increment(statusCounts, safeCategory(run.status));
    sourcesDiscovered += run.sourcesDiscovered;
    if (run.requestedLimit !== null && run.requestedLimit > 0) {
      requestedSlots += run.requestedLimit;
      discoveredWithinLimit += Math.min(
        run.sourcesDiscovered,
        run.requestedLimit,
      );
    }
    const errors = run.summary?.errors ?? run.runErrorCodes;
    for (const error of new Set([...errors, ...run.runErrorCodes])) {
      increment(errorCounts, error);
      increment(lossCategoryCounts, lossCategory(error));
    }
    if (!run.summary) continue;
    usableDraftWrites += run.summary.eventsWritten;
    if (run.summary.diagnostics.length > 0) diagnosticCoveredRuns++;
    if (run.summary.diagnostics.some((item) => item.phase === "repair"))
      repairRuns++;
  }
  return {
    runs: runs.length,
    first_started_at: runs[0]?.startedAt ?? null,
    last_started_at: runs.at(-1)?.startedAt ?? null,
    status_counts: statusCounts,
    requested_candidate_slots: requestedSlots,
    sources_discovered: sourcesDiscovered,
    candidate_slot_fill_rate: ratio(discoveredWithinLimit, requestedSlots),
    usable_draft_writes: usableDraftWrites,
    usable_draft_write_rate_per_discovered_source: ratio(
      usableDraftWrites,
      sourcesDiscovered,
    ),
    diagnostic_covered_runs: diagnosticCoveredRuns,
    repair_runs: repairRuns,
    repair_run_rate: ratio(repairRuns, diagnosticCoveredRuns),
    error_counts: errorCounts,
    loss_category_counts: lossCategoryCounts,
  };
}

/** Produce aggregate metrics without returning IDs or private text. */
export function evaluateIngestionHistory(
  input: EvaluationInput,
): UnknownRecord {
  const statusCounts: Record<string, number> = {};
  const errorCounts: Record<string, number> = {};
  const lossCategoryCounts: Record<string, number> = {};
  const phaseCounts: Record<string, number> = {};
  const extractionShapes: Record<string, number> = {};
  const extractionFormats: Record<string, number> = {};
  const repairValidations: Record<string, number> = {};
  const terminalRuns = input.runs.filter((run) =>
    TERMINAL_STATUSES.has(run.status),
  );
  const summarizedRuns = terminalRuns.filter((run) => run.summary);
  let requestedSlots = 0;
  let discoveredWithinLimit = 0;
  let runsWithRequestedLimit = 0;
  let runsFillingLimit = 0;
  let runsWithAnySource = 0;
  let usableDraftWrites = 0;
  let sourceOnlyObservations = 0;
  let runsWithDraftWrites = 0;
  let providerRequests = 0;
  let repairRuns = 0;
  let diagnosticCoveredRuns = 0;
  let reportedCost = 0;
  let costCompleteRuns = 0;
  let costCompleteDraftWrites = 0;
  let costCompleteSpend = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let totalTokens = 0;
  for (const run of input.runs)
    increment(statusCounts, safeCategory(run.status));
  for (const run of terminalRuns) {
    if (run.sourcesDiscovered > 0) runsWithAnySource++;
    if (run.requestedLimit !== null && run.requestedLimit > 0) {
      requestedSlots += run.requestedLimit;
      discoveredWithinLimit += Math.min(
        run.sourcesDiscovered,
        run.requestedLimit,
      );
      runsWithRequestedLimit++;
      if (run.sourcesDiscovered >= run.requestedLimit) runsFillingLimit++;
    }
    if (!run.summary) {
      for (const error of run.runErrorCodes) {
        increment(errorCounts, error);
        increment(lossCategoryCounts, lossCategory(error));
      }
      continue;
    }
    usableDraftWrites += run.summary.eventsWritten;
    sourceOnlyObservations += run.summary.sourcesUnlinked;
    if (run.summary.eventsWritten > 0) runsWithDraftWrites++;
    for (const error of new Set([
      ...run.summary.errors,
      ...run.runErrorCodes,
    ])) {
      increment(errorCounts, error);
      increment(lossCategoryCounts, lossCategory(error));
    }
    providerRequests += run.summary.diagnostics.length;
    if (run.summary.diagnostics.length > 0) diagnosticCoveredRuns++;
    if (run.summary.diagnostics.some((item) => item.phase === "repair"))
      repairRuns++;
    let completeCost = run.summary.diagnostics.length > 0;
    let runCost = 0;
    for (const diagnostic of run.summary.diagnostics) {
      increment(phaseCounts, diagnostic.phase);
      if (diagnostic.extractionShape)
        increment(extractionShapes, diagnostic.extractionShape);
      if (diagnostic.extractionFormat)
        increment(extractionFormats, diagnostic.extractionFormat);
      if (diagnostic.repairValidation)
        increment(repairValidations, diagnostic.repairValidation);
      if (diagnostic.cost === null) completeCost = false;
      else {
        runCost += diagnostic.cost;
        reportedCost += diagnostic.cost;
      }
      inputTokens += diagnostic.inputTokens ?? 0;
      outputTokens += diagnostic.outputTokens ?? 0;
      reasoningTokens += diagnostic.reasoningTokens ?? 0;
      totalTokens += diagnostic.totalTokens ?? 0;
    }
    if (completeCost) {
      costCompleteRuns++;
      costCompleteSpend += runCost;
      costCompleteDraftWrites += run.summary.eventsWritten;
    }
  }
  const discoveryFillRate = ratio(discoveredWithinLimit, requestedSlots);
  const draftWriteRate = ratio(
    usableDraftWrites,
    terminalRuns.reduce((sum, run) => sum + run.sourcesDiscovered, 0),
  );
  const repairRunRate = ratio(repairRuns, diagnosticCoveredRuns);
  const runningRuns = statusCounts.running ?? 0;
  const recentCohort = summarizeCohort(terminalRuns.slice(-5));
  const recentFillRate = recentCohort.candidate_slot_fill_rate as number | null;
  const recentDraftRate =
    recentCohort.usable_draft_write_rate_per_discovered_source as number | null;
  const recentRepairRate = recentCohort.repair_run_rate as number | null;
  const recentLossCategory = dominantCategory(
    recentCohort.loss_category_counts as Record<string, number>,
  );
  const sourcePortfolio = summarizeSourcePortfolio(
    input.databaseState.sourcePortfolio,
  );
  const marketplaceShare = sourcePortfolio.marketplace_consultation_share as
    number | null;
  const familyMetrics = sourcePortfolio.family_metrics as Record<
    string,
    UnknownRecord
  >;
  const weakSourceFamily = Object.entries(familyMetrics)
    .filter(
      ([, metrics]) =>
        (metrics.stored_sources as number) >= 3 &&
        (metrics.linked_source_rate as number | null) !== null &&
        (metrics.linked_source_rate as number) < 0.5,
    )
    .sort(
      ([leftName, left], [rightName, right]) =>
        (left.linked_source_rate as number) -
          (right.linked_source_rate as number) ||
        leftName.localeCompare(rightName),
    )[0];
  const recommendations: UnknownRecord[] = [];
  if (runningRuns > 0)
    recommendations.push({
      focus: "close_interrupted_runs",
      evidence: `${runningRuns} historical run records are still marked running.`,
      next_experiment:
        "Preview each record with ingest:recover and close only confirmed interrupted runs.",
    });
  if (recentDraftRate !== null && recentDraftRate < 0.5)
    recommendations.push({
      focus: "candidate_to_draft_conversion",
      evidence: `The latest five terminal runs converted ${(recentDraftRate * 100).toFixed(1)}% of discovered source observations into usable draft writes${recentLossCategory ? `; ${recentLossCategory} was the most frequent recorded loss category` : ""}.`,
      next_experiment:
        recentLossCategory === "response_shape"
          ? "Replay preserved recent response-shape failures through the current offline parser and repair boundary."
          : "Inspect the dominant safe loss category before changing prompts or models.",
    });
  if (recentFillRate !== null && recentFillRate < 0.75)
    recommendations.push({
      focus: "discovery_recall",
      evidence: `The latest five terminal runs filled ${(recentFillRate * 100).toFixed(1)}% of requested candidate slots.`,
      next_experiment:
        "Compare bounded search-query strategies on one fixed window before changing extraction.",
    });
  if (weakSourceFamily)
    recommendations.push({
      focus: "source_family_conversion",
      evidence: `${weakSourceFamily[0]} linked ${((weakSourceFamily[1].linked_source_rate as number) * 100).toFixed(1)}% of its stored source rows to events.`,
      next_experiment: `Preserve the next bounded ${weakSourceFamily[0]} failure and replay it through the current capture and extraction boundary before expanding that source family.`,
    });
  if (marketplaceShare !== null && marketplaceShare >= 0.8)
    recommendations.push({
      focus: "source_portfolio_diversity",
      evidence: `Marketplace listing platforms account for ${(marketplaceShare * 100).toFixed(1)}% of recorded listing consultations.`,
      next_experiment:
        "Compare one bounded first-party organizer cohort with the marketplace baseline before adding another broad source adapter.",
    });
  if (recentRepairRate !== null && recentRepairRate >= 0.25)
    recommendations.push({
      focus: "structured_output_compatibility",
      evidence: `${(recentRepairRate * 100).toFixed(1)}% of diagnostic-covered runs in the latest five terminal runs used repair.`,
      next_experiment:
        "Evaluate extraction-shape compliance separately from factual quality using captured responses.",
    });
  if (!recommendations.length)
    recommendations.push({
      focus: "manual_factual_verification",
      evidence:
        "No aggregate operational threshold currently dominates the report.",
      next_experiment:
        "Manually verify the newest private drafts against their canonical listing pages.",
    });
  return {
    mode: "offline_ingestion_quality_evaluation",
    generated_at: new Date().toISOString(),
    coverage: {
      discovery_runs: input.runs.length,
      terminal_runs: terminalRuns.length,
      running_runs: runningRuns,
      summarized_terminal_runs: summarizedRuns.length,
      unsummarized_terminal_runs: terminalRuns.length - summarizedRuns.length,
      checkpoint_files_read: input.checkpoints.filesRead,
      invalid_checkpoint_files: input.checkpoints.invalidFiles,
      checkpoint_runs_matched: input.checkpoints.matchedRuns,
      checkpoint_runs_unmatched: input.checkpoints.unmatchedRuns,
    },
    outcomes: {
      status_counts: statusCounts,
      runs_with_any_source: runsWithAnySource,
      runs_with_usable_draft_writes: runsWithDraftWrites,
      usable_draft_writes: usableDraftWrites,
      source_only_observations: sourceOnlyObservations,
      error_counts: errorCounts,
      loss_category_counts: lossCategoryCounts,
    },
    discovery: {
      runs_with_requested_limit: runsWithRequestedLimit,
      requested_candidate_slots: requestedSlots,
      discovered_candidates_within_limit: discoveredWithinLimit,
      runs_filling_requested_limit: runsFillingLimit,
      candidate_slot_fill_rate: discoveryFillRate,
      usable_draft_write_rate_per_discovered_source: draftWriteRate,
    },
    source_portfolio: sourcePortfolio,
    recent_cohort: recentCohort,
    compatibility: {
      repair_runs: repairRuns,
      repair_run_rate: repairRunRate,
      diagnostic_covered_runs: diagnosticCoveredRuns,
      phase_counts: phaseCounts,
      extraction_shape_counts: extractionShapes,
      extraction_format_counts: extractionFormats,
      repair_validation_counts: repairValidations,
    },
    usage: {
      provider_requests_observed: providerRequests,
      provider_reported_cost_usd: money(reportedCost),
      cost_complete_runs: costCompleteRuns,
      cost_complete_usable_draft_writes: costCompleteDraftWrites,
      cost_per_usable_draft_write_usd:
        costCompleteDraftWrites > 0
          ? money(costCompleteSpend / costCompleteDraftWrites)
          : null,
      reported_input_tokens: inputTokens,
      reported_output_tokens: outputTokens,
      reported_reasoning_tokens: reasoningTokens,
      reported_total_tokens: totalTokens,
    },
    current_database_state: {
      events: input.databaseState.events,
      nonfixture_events: input.databaseState.nonfixtureEvents,
      sources: input.databaseState.sources,
      linked_sources: input.databaseState.linkedSources,
      unlinked_sources: input.databaseState.unlinkedSources,
      publication_status_counts: input.databaseState.publicationStatuses,
      latest_source_error_counts: input.databaseState.sourceErrorCounts,
    },
    recommendations: recommendations.map((recommendation, index) => ({
      priority: index + 1,
      ...recommendation,
    })),
    limitations: [
      "Historical runs span changing prompts, schemas, models, and compatibility code; they are not a controlled model comparison.",
      "Usable draft writes include refreshed drafts and are not a count of unique newly created events.",
      "Provider-reported costs and token counts are unverified and may be incomplete.",
      "Latest source errors describe current source rows, not an append-only history of every attempt.",
      "Aggregate metrics do not replace manual factual verification against canonical listing pages.",
    ],
    safety: {
      network_requests: 0,
      paid_requests: 0,
      database_writes: 0,
      publication_changes: 0,
      private_content_in_report: false,
    },
  };
}

/** Run the read-only evaluation and write one owner-only ignored report. */
export async function runEvaluationCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<UnknownRecord> {
  const options = parseEvaluationOptions(args, cwd);
  if (options.command === "help") return { help: EVALUATION_HELP };
  const selection = readDatabaseSelection(env, cwd);
  if (selection.backend !== "sqlite")
    throw new Error(
      "Offline ingestion evaluation currently supports SQLite only; no backend fallback was attempted.",
    );
  const input = await loadEvaluationInput(
    selection.path,
    options.checkpointDirectory,
  );
  const report = evaluateIngestionHistory(input);
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  await chmod(options.outputPath, 0o600);
  const coverage = report.coverage as UnknownRecord;
  const discovery = report.discovery as UnknownRecord;
  const usage = report.usage as UnknownRecord;
  const recommendations = report.recommendations as UnknownRecord[];
  return {
    mode: report.mode,
    report_path: relative(cwd, options.outputPath),
    discovery_runs: coverage.discovery_runs,
    summarized_terminal_runs: coverage.summarized_terminal_runs,
    candidate_slot_fill_rate: discovery.candidate_slot_fill_rate,
    usable_draft_writes: (report.outcomes as UnknownRecord).usable_draft_writes,
    cost_per_usable_draft_write_usd: usage.cost_per_usable_draft_write_usd,
    top_recommendation: recommendations[0] ?? null,
    safety: report.safety,
  };
}
