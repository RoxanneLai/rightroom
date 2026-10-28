import "server-only";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { readCareerTarget } from "../career/profile.ts";
import { readDatabaseSelection } from "../storage/config.ts";
import type { CareerTarget } from "../career/profile.ts";
import type { SearchOptions } from "./contracts.ts";
import { parseSafeRunSummary } from "./evaluation.ts";
import { defaultSearchOptions, validateSearchOptions } from "./options.ts";
import { allowedDomainsForScope } from "./sources.ts";
import { careerSearchPlan } from "../career/profile.ts";

type UnknownRecord = Record<string, unknown>;
type ComparisonScope = "marketplace" | "product_circle";

type PlanOptions = {
  command: "plan";
  from: string;
  to: string;
  searches: number;
  limit: number;
};

type EvaluationOptions = {
  command: "evaluate";
  marketplaceRun: string;
  productCircleRun: string;
  marketplaceReviewMinutes: number | null;
  productCircleReviewMinutes: number | null;
  outputPath: string;
};

type HelpOptions = { command: "help" };
export type ComparisonOptions = PlanOptions | EvaluationOptions | HelpOptions;

type StoredComparisonRun = {
  status: string;
  parameters: SearchOptions;
  sourcesDiscovered: number;
  summary: NonNullable<ReturnType<typeof parseSafeRunSummary>>;
  capturesSucceeded: number;
  capturesFailed: number;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);

export const DISCOVERY_COMPARISON_HELP = `Prepare a controlled PM discovery comparison without spending money:
  npm run ingest:compare -- [--from ISO] [--to ISO] [--searches 1..3] [--limit 1..10]

Evaluate two separately approved completed SQLite runs read-only:
  npm run ingest:compare -- evaluate \\
    --marketplace-run UUID --product-circle-run UUID \\
    [--marketplace-review-minutes 0..1440] \\
    [--product-circle-review-minutes 0..1440] \\
    [--output codex-tmp/discovery-comparison.json]

Plan mode is the default. It reads only the non-secret career profile and makes no
network requests, paid calls, database reads/writes, publications, or artifacts.
Evaluation accepts only a matched fixed-window pair with career/product/expand and
the expected source scopes. It reports aggregate outcomes, never source text,
research, URLs, raw provider responses, or private event facts.`;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function boundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error("invalid_comparison_arguments");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error("invalid_comparison_arguments");
  return parsed;
}

function optionalMinutes(value: string | undefined): number | null {
  return value === undefined ? null : boundedInteger(value, 0, 1440, 0);
}

function rejectDuplicateOptions(
  tokens: Array<{ kind: string; name?: string }>,
): void {
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option" || !token.name) continue;
    if (seen.has(token.name)) throw new Error("invalid_comparison_arguments");
    seen.add(token.name);
  }
}

function comparisonOutputPath(path: string, cwd: string): string {
  const root = resolve(cwd, "codex-tmp");
  const target = resolve(cwd, path);
  const relativePath = relative(root, target);
  if (
    !target.endsWith(".json") ||
    relativePath === "" ||
    relativePath.startsWith("..") ||
    relativePath.startsWith("/")
  )
    throw new Error("invalid_comparison_output_path");
  return target;
}

function parsePlanOptions(args: string[], now: Date): PlanOptions {
  let values;
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      tokens: true,
      options: {
        from: { type: "string" },
        to: { type: "string" },
        searches: { type: "string" },
        limit: { type: "string" },
      },
    });
    rejectDuplicateOptions(parsed.tokens);
    values = parsed.values;
  } catch {
    throw new Error("invalid_comparison_arguments");
  }
  if ((values.from && !values.to) || (!values.from && values.to))
    throw new Error("invalid_comparison_arguments");
  const defaults = defaultSearchOptions(now, "career");
  const searches = boundedInteger(values.searches, 1, 3, 3);
  const limit = boundedInteger(values.limit, 1, 10, 3);
  const validated = validateSearchOptions({
    from: values.from ?? defaults.from,
    to: values.to ?? defaults.to,
    limit,
    profile: "career",
    searches,
    intent: "expand",
    search_focus: "product",
  });
  return {
    command: "plan",
    from: validated.from,
    to: validated.to,
    searches,
    limit,
  };
}

function parseEvaluationOptions(
  args: string[],
  cwd: string,
): EvaluationOptions {
  let values;
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      tokens: true,
      options: {
        "marketplace-run": { type: "string" },
        "product-circle-run": { type: "string" },
        "marketplace-review-minutes": { type: "string" },
        "product-circle-review-minutes": { type: "string" },
        output: { type: "string" },
      },
    });
    rejectDuplicateOptions(parsed.tokens);
    values = parsed.values;
  } catch {
    throw new Error("invalid_comparison_arguments");
  }
  if (
    !values["marketplace-run"] ||
    !UUID.test(values["marketplace-run"]) ||
    !values["product-circle-run"] ||
    !UUID.test(values["product-circle-run"]) ||
    values["marketplace-run"] === values["product-circle-run"]
  )
    throw new Error("invalid_comparison_arguments");
  return {
    command: "evaluate",
    marketplaceRun: values["marketplace-run"],
    productCircleRun: values["product-circle-run"],
    marketplaceReviewMinutes: optionalMinutes(
      values["marketplace-review-minutes"],
    ),
    productCircleReviewMinutes: optionalMinutes(
      values["product-circle-review-minutes"],
    ),
    outputPath: comparisonOutputPath(
      values.output ?? "codex-tmp/discovery-comparison.json",
      cwd,
    ),
  };
}

/** Validate the complete command before reading configuration or storage. */
export function parseComparisonOptions(
  args: string[],
  now = new Date(),
  cwd = process.cwd(),
): ComparisonOptions {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]))
    return { command: "help" };
  if (args[0] === "evaluate") return parseEvaluationOptions(args.slice(1), cwd);
  if (args[0] === "plan") return parsePlanOptions(args.slice(1), now);
  return parsePlanOptions(args, now);
}

function armOptions(
  options: PlanOptions,
  target: CareerTarget,
  sourceScope: ComparisonScope,
): SearchOptions {
  return validateSearchOptions({
    from: options.from,
    to: options.to,
    limit: options.limit,
    profile: "career",
    searches: options.searches,
    intent: "expand",
    search_focus: "product",
    source_scope: sourceScope,
    career_target: target,
  });
}

function commandArguments(options: SearchOptions): string[] {
  return [
    "--profile",
    "career",
    "--search-focus",
    "product",
    "--source-scope",
    options.source_scope === "product_circle"
      ? "product-circle"
      : String(options.source_scope),
    "--intent",
    "expand",
    "--searches",
    String(options.searches),
    "--limit",
    String(options.limit),
    "--from",
    options.from,
    "--to",
    options.to,
  ];
}

function publicSearchOptions(options: SearchOptions): UnknownRecord {
  return {
    from: options.from,
    to: options.to,
    limit: options.limit,
    profile: options.profile,
    searches: options.searches,
    intent: options.intent,
    search_focus: options.search_focus,
    source_scope: options.source_scope,
    career_profile_version: options.career_target?.version,
  };
}

/** Build two immutable, same-window plans; no live work is performed. */
export function buildComparisonPlan(
  options: PlanOptions,
  target: CareerTarget,
): UnknownRecord {
  const scopes: ComparisonScope[] = ["marketplace", "product_circle"];
  const arms = scopes.map((scope) => {
    const search = armOptions(options, target, scope);
    return {
      label: scope === "marketplace" ? "marketplace" : "product_circle",
      options: publicSearchOptions(search),
      allowed_domains: allowedDomainsForScope(scope),
      planned_queries: careerSearchPlan(search),
      live_command_arguments: commandArguments(search),
    };
  });
  return {
    mode: "discovery_comparison_plan_only",
    comparison_version: "marketplace-vs-product-circle-v1",
    shared_window: { from: options.from, to: options.to },
    shared_settings: {
      profile: "career",
      search_focus: "product",
      intent: "expand",
      searches: options.searches,
      candidate_limit: options.limit,
      career_profile_version: target.version,
    },
    arms,
    evaluation_metrics: [
      "candidate_slot_fill_rate",
      "capture_success_rate",
      "usable_draft_write_rate",
      "provider_reported_cost_usd",
      "review_items",
      "review_minutes_when_supplied",
    ],
    executed_queries: null,
    writes: false,
    network_requests: 0,
    paid_calls: false,
    live_execution_authorized: false,
    next: "Review this plan and separately authorize each paid run; zero results are valid and do not authorize retries.",
  };
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function captureCounts(metadata: unknown): {
  succeeded: number;
  failed: number;
} {
  const parsed = parseJson(metadata);
  const summary = isRecord(parsed) ? parsed.summary : null;
  const diagnostics = isRecord(summary)
    ? summary.source_capture_diagnostics
    : null;
  let succeeded = 0;
  let failed = 0;
  if (Array.isArray(diagnostics))
    for (const diagnostic of diagnostics.slice(0, 10)) {
      if (!isRecord(diagnostic)) continue;
      if (diagnostic.status === "captured") succeeded++;
      else if (diagnostic.status === "failed") failed++;
    }
  return { succeeded, failed };
}

function storedRun(
  row: UnknownRecord | undefined,
  expectedId: string,
  expectedScope: ComparisonScope,
): StoredComparisonRun {
  if (
    !row ||
    String(row.id) !== expectedId ||
    !TERMINAL_STATUSES.has(String(row.status))
  )
    throw new Error("comparison_run_unavailable");
  let parameters: SearchOptions;
  try {
    parameters = validateSearchOptions(parseJson(row.search_parameters));
  } catch {
    throw new Error("comparison_run_mismatch");
  }
  const summaryContainer = parseJson(row.metadata);
  const summary = parseSafeRunSummary(
    isRecord(summaryContainer) ? summaryContainer.summary : null,
  );
  if (
    parameters.profile !== "career" ||
    parameters.intent !== "expand" ||
    parameters.search_focus !== "product" ||
    parameters.source_scope !== expectedScope ||
    !summary ||
    summary.runId !== expectedId
  )
    throw new Error("comparison_run_mismatch");
  const captures = captureCounts(row.metadata);
  return {
    status: String(row.status),
    parameters,
    sourcesDiscovered: nonnegativeInteger(row.sources_discovered) ?? 0,
    summary,
    capturesSucceeded: captures.succeeded,
    capturesFailed: captures.failed,
  };
}

function assertMatchedRuns(
  marketplace: StoredComparisonRun,
  productCircle: StoredComparisonRun,
): void {
  for (const key of ["from", "to", "limit", "searches"] as const)
    if (marketplace.parameters[key] !== productCircle.parameters[key])
      throw new Error("comparison_window_or_budget_mismatch");
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function armMetrics(
  run: StoredComparisonRun,
  reviewMinutes: number | null,
): UnknownRecord {
  const requestedSlots = run.parameters.limit;
  const captureAttempts = run.capturesSucceeded + run.capturesFailed;
  const knownCosts = run.summary.diagnostics
    .map((diagnostic) => diagnostic.cost)
    .filter((cost): cost is number => cost !== null);
  const costComplete =
    run.summary.diagnostics.length > 0 &&
    knownCosts.length === run.summary.diagnostics.length;
  return {
    status: run.status,
    requested_candidate_slots: requestedSlots,
    sources_discovered: run.sourcesDiscovered,
    candidate_slot_fill_rate: ratio(
      Math.min(run.sourcesDiscovered, requestedSlots),
      requestedSlots,
    ),
    captures_succeeded: run.capturesSucceeded,
    captures_failed: run.capturesFailed,
    capture_success_rate: ratio(run.capturesSucceeded, captureAttempts),
    usable_draft_writes: run.summary.eventsWritten,
    usable_draft_write_rate: ratio(
      run.summary.eventsWritten,
      run.sourcesDiscovered,
    ),
    sources_unlinked: run.summary.sourcesUnlinked,
    error_codes: run.summary.errors,
    provider_reported_cost_usd: costComplete
      ? Number(knownCosts.reduce((sum, cost) => sum + cost, 0).toFixed(8))
      : null,
    review_items: run.sourcesDiscovered,
    review_minutes: reviewMinutes,
    review_minutes_per_draft:
      reviewMinutes !== null
        ? ratio(reviewMinutes, run.summary.eventsWritten)
        : null,
  };
}

/** Read exactly two aggregate run records; never return private source data. */
export function evaluateComparison(
  databasePath: string,
  options: EvaluationOptions,
): UnknownRecord {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `select id, status, search_parameters, sources_discovered, metadata
         from search_runs where id in (?, ?) order by id`,
      )
      .all(options.marketplaceRun, options.productCircleRun) as UnknownRecord[];
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const marketplace = storedRun(
      byId.get(options.marketplaceRun),
      options.marketplaceRun,
      "marketplace",
    );
    const productCircle = storedRun(
      byId.get(options.productCircleRun),
      options.productCircleRun,
      "product_circle",
    );
    assertMatchedRuns(marketplace, productCircle);
    return {
      mode: "offline_discovery_comparison",
      comparison_version: "marketplace-vs-product-circle-v1",
      shared_window: {
        from: marketplace.parameters.from,
        to: marketplace.parameters.to,
      },
      shared_settings: {
        profile: "career",
        search_focus: "product",
        intent: "expand",
        searches: marketplace.parameters.searches,
        candidate_limit: marketplace.parameters.limit,
      },
      arms: {
        marketplace: armMetrics(marketplace, options.marketplaceReviewMinutes),
        product_circle: armMetrics(
          productCircle,
          options.productCircleReviewMinutes,
        ),
      },
      limitations: [
        "Provider-reported costs are unverified and remain null unless every recorded request has a numeric cost.",
        "Review item counts are workload proxies; actual operator effort is reported only when review minutes are supplied.",
        "Draft writes are not publication approvals, unique new events, or evidence of recommendation usefulness.",
        "One paired window does not establish repeatable discovery quality.",
      ],
      safety: {
        network_requests: 0,
        paid_requests: 0,
        database_writes: 0,
        publication_changes: 0,
        private_content_in_report: false,
      },
    };
  } finally {
    database.close();
  }
}

async function saveEvaluation(
  report: UnknownRecord,
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  await chmod(outputPath, 0o600);
}

/** Execute free plan generation or a read-only matched-run evaluation. */
export async function runComparisonCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  now = new Date(),
): Promise<UnknownRecord> {
  const options = parseComparisonOptions(args, now, cwd);
  if (options.command === "help") return { help: DISCOVERY_COMPARISON_HELP };
  if (options.command === "plan")
    return buildComparisonPlan(
      options,
      await readCareerTarget(resolve(cwd, "config/career.json")),
    );
  const selection = readDatabaseSelection(env, cwd);
  if (selection.backend !== "sqlite")
    throw new Error("comparison_evaluation_requires_sqlite");
  const report = evaluateComparison(selection.path, options);
  await saveEvaluation(report, options.outputPath);
  return {
    mode: report.mode,
    report_path: relative(cwd, options.outputPath),
    shared_window: report.shared_window,
    arms: report.arms,
    safety: report.safety,
  };
}
