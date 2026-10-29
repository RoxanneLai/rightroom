import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { readCareerTarget } from "../../lib/career/profile.ts";
import {
  buildComparisonPlan,
  evaluateComparison,
  parseComparisonOptions,
  runComparisonCli,
} from "../../lib/ingestion/discovery-comparison.ts";
import {
  parseComparisonReviewOptions,
  prepareComparisonReview,
  safeComparisonReviewError,
} from "../../lib/ingestion/discovery-comparison-review.ts";
import { parseIngestionArgs } from "../../lib/ingestion/cli.ts";
import { collectDiscoveryExclusions } from "../../lib/ingestion/exclusions.ts";
import { OpenRouterSearchProvider } from "../../lib/ingestion/openrouter-provider.ts";
import {
  allowedDomainsForScope,
  selectSources,
} from "../../lib/ingestion/sources.ts";
import { openSqliteDatabase } from "../../lib/storage/sqlite.ts";
import { memoryRepository } from "./helpers.mjs";

const now = new Date("2026-10-28T12:00:00Z");
const marketplaceRun = "90000000-0000-4000-8000-000000000021";
const productCircleRun = "90000000-0000-4000-8000-000000000022";
const productCircleUrl =
  "https://productcircle.co/events/new-york-november-2026";

async function temporaryDirectory() {
  await mkdir("codex-tmp", { recursive: true });
  const path = await mkdtemp(resolve("codex-tmp/discovery-comparison-test-"));
  await chmod(path, 0o700);
  return path;
}

function comparisonOptions(sourceScope) {
  return {
    from: "2026-11-01T00:00:00Z",
    to: "2026-12-01T00:00:00Z",
    limit: 3,
    profile: "career",
    searches: 3,
    intent: "expand",
    search_focus: "product",
    source_scope: sourceScope,
  };
}

function diagnostic(phase, cost) {
  return {
    phase,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      reasoning_tokens: 0,
      total_tokens: 15,
      cost,
    },
  };
}

function summary(runId, overrides = {}) {
  return {
    run_id: runId,
    status: "succeeded",
    sources_discovered: 2,
    sources_created: 2,
    sources_updated: 0,
    events_written: 1,
    sources_unlinked: 1,
    errors: [],
    provider_diagnostics: [
      diagnostic("research", 0.01),
      diagnostic("extraction", 0.005),
    ],
    source_capture_diagnostics: [
      { source_id: "source-1", status: "captured" },
      {
        source_id: "source-2",
        status: "failed",
        error_code: "source_capture_fetch_failed",
      },
    ],
    ...overrides,
  };
}

function seedRun(database, runId, sourceScope, overrides = {}) {
  const search = {
    ...comparisonOptions(sourceScope),
    ...(overrides.search ?? {}),
  };
  const runSummary = summary(runId, overrides.summary);
  const timestamp = "2026-10-28T12:00:00.000Z";
  database
    .prepare(
      `insert into search_runs (
        id, agent_name, provider, search_parameters, status, started_at,
        completed_at, sources_discovered, sources_created, sources_updated,
        metadata, created_at, updated_at
      ) values (?, 'founder-radar-discovery', 'openrouter-web-search', ?, ?, ?,
        ?, ?, 2, 0, ?, ?, ?)`,
    )
    .run(
      runId,
      JSON.stringify(search),
      overrides.status ?? "succeeded",
      timestamp,
      timestamp,
      runSummary.sources_discovered,
      JSON.stringify({
        summary: runSummary,
        research_report: "PRIVATE RESEARCH TEXT",
        consulted_urls: ["https://private.example/event"],
        raw_provider_response: "PRIVATE PROVIDER DATA",
      }),
      timestamp,
      timestamp,
    );
}

test("comparison planning is free, paired, fixed-window, and source-isolated", async () => {
  const target = await readCareerTarget();
  const parsed = parseComparisonOptions(
    [
      "--from",
      "2026-11-01T00:00:00Z",
      "--to",
      "2026-12-01T00:00:00Z",
      "--searches",
      "2",
      "--limit",
      "3",
    ],
    now,
  );
  assert.equal(parsed.command, "plan");
  const plan = buildComparisonPlan(parsed, target);
  assert.deepEqual(plan.shared_window, {
    from: "2026-11-01T00:00:00Z",
    to: "2026-12-01T00:00:00Z",
  });
  assert.equal(plan.arms.length, 2);
  assert.deepEqual(
    plan.arms.map((arm) => arm.options.source_scope),
    ["marketplace", "product_circle"],
  );
  assert.deepEqual(plan.arms[0].allowed_domains, [
    "luma.com",
    "lu.ma",
    "meetup.com",
    "eventbrite.com",
  ]);
  assert.deepEqual(plan.arms[1].allowed_domains, ["productcircle.co"]);
  assert.equal(plan.network_requests, 0);
  assert.equal(plan.paid_calls, false);
  assert.equal(plan.writes, false);
  assert.equal(plan.live_execution_authorized, false);
  const direct = await runComparisonCli([], {}, process.cwd(), now);
  assert.equal(direct.mode, "discovery_comparison_plan_only");
  assert.equal(direct.live_execution_authorized, false);
});

test("comparison arguments reject duplicates, unsafe outputs, and unmatched run IDs before storage", () => {
  for (const args of [
    ["--limit", "2", "--limit", "3"],
    ["--from", "2026-11-01T00:00:00Z"],
    ["--searches", "4"],
    ["evaluate", "--marketplace-run", marketplaceRun],
    [
      "evaluate",
      "--marketplace-run",
      marketplaceRun,
      "--product-circle-run",
      marketplaceRun,
    ],
    [
      "evaluate",
      "--marketplace-run",
      marketplaceRun,
      "--product-circle-run",
      productCircleRun,
      "--output",
      "outside.json",
    ],
  ])
    assert.throws(() => parseComparisonOptions(args, now));
});

test("comparison review arguments are strict and keep every artifact under codex-tmp", () => {
  assert.equal(parseComparisonReviewOptions([]).command, "help");
  assert.equal(
    parseComparisonReviewOptions([
      "prepare",
      "--marketplace-run",
      marketplaceRun,
      "--product-circle-run",
      productCircleRun,
    ]).command,
    "prepare",
  );
  for (const args of [
    ["prepare", "--marketplace-run", marketplaceRun],
    [
      "prepare",
      "--marketplace-run",
      marketplaceRun,
      "--marketplace-run",
      marketplaceRun,
      "--product-circle-run",
      productCircleRun,
    ],
    ["evaluate", "--input", "outside.json"],
    ["evaluate", "--input", "codex-tmp/input.json", "--output", "../x.json"],
    ["unknown"],
  ])
    assert.throws(() => parseComparisonReviewOptions(args));
});

test("comparison review CLI errors never echo private validator input", () => {
  assert.equal(
    safeComparisonReviewError(new Error("comparison_review_incomplete")),
    "comparison_review_incomplete",
  );
  assert.equal(
    safeComparisonReviewError(
      new Error('Invalid value: "https://private.example/event"'),
    ),
    "comparison_review_failed",
  );
});

test("source scope constrains CLI, exclusions, final selection, and hosted-search domains", async () => {
  assert.equal(
    parseIngestionArgs(["--source-scope", "product-circle"], now).options
      .source_scope,
    "product_circle",
  );
  assert.throws(
    () =>
      parseIngestionArgs(
        ["--profile", "founder", "--source-scope", "marketplace"],
        now,
      ),
    /invalid_cli_arguments/,
  );
  assert.deepEqual(allowedDomainsForScope("product_circle"), [
    "productcircle.co",
  ]);
  assert.deepEqual(
    selectSources(
      ["https://luma.com/first", productCircleUrl],
      1,
      [],
      "product_circle",
    ).map((source) => source.source_url),
    [productCircleUrl],
  );
  const repository = memoryRepository();
  let requestedNames;
  repository.listRecentCancelledSourceUrls = async (_since, _limit, names) => {
    requestedNames = names;
    return ["https://luma.com/excluded", productCircleUrl];
  };
  repository.listLinkedSourceUrls = async () => [];
  const exclusions = await collectDiscoveryExclusions(
    { ...comparisonOptions("product_circle"), intent: "refresh" },
    repository,
    now,
  );
  assert.deepEqual(requestedNames, ["productcircle.co"]);
  assert.deepEqual(exclusions.urls, [productCircleUrl]);

  const target = await readCareerTarget();
  let requestBody;
  const provider = new OpenRouterSearchProvider(
    "offline-not-a-key",
    "vendor/offline",
    "low",
    async (_input, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          id: "gen-source-scope",
          model: "vendor/offline",
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: `Lead ${productCircleUrl}\n\n\`\`\`rightroom-discovery-v1\n${JSON.stringify({ version: "rightroom-discovery-v1", listings: [{ source_url: productCircleUrl, disposition: "needs_verification" }] })}\n\`\`\``,
                annotations: [
                  {
                    type: "url_citation",
                    url_citation: { url: productCircleUrl },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 10,
            total_tokens: 20,
            server_tool_use: { web_search_requests: 1 },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );
  const research = await provider.research(
    {
      ...comparisonOptions("product_circle"),
      searches: 1,
      career_target: target,
    },
    new AbortController().signal,
  );
  assert.deepEqual(requestBody.tools[0].parameters.allowed_domains, [
    "productcircle.co",
  ]);
  assert.deepEqual(research.urls, [productCircleUrl]);
  assert.equal(research.metadata.source_scope, "product_circle");
});

test("evaluation reads one matched pair, reports safe aggregates, and writes owner-only JSON", async () => {
  const directory = await temporaryDirectory();
  const databasePath = join(directory, "comparison.sqlite");
  const database = openSqliteDatabase(databasePath);
  seedRun(database, marketplaceRun, "marketplace");
  seedRun(database, productCircleRun, "product_circle", {
    summary: {
      events_written: 2,
      sources_unlinked: 0,
      provider_diagnostics: [diagnostic("research", 0.02)],
      source_capture_diagnostics: [
        { source_id: "source-3", status: "captured" },
        { source_id: "source-4", status: "captured" },
      ],
    },
  });
  database.close();
  const evaluation = parseComparisonOptions(
    [
      "evaluate",
      "--marketplace-run",
      marketplaceRun,
      "--product-circle-run",
      productCircleRun,
      "--marketplace-review-minutes",
      "12",
      "--product-circle-review-minutes",
      "8",
      "--output",
      join("codex-tmp", directory.split("/").at(-1), "report.json"),
    ],
    now,
  );
  assert.equal(evaluation.command, "evaluate");
  const report = evaluateComparison(databasePath, evaluation);
  assert.equal(report.arms.marketplace.candidate_slot_fill_rate, 0.6667);
  assert.equal(report.arms.marketplace.capture_success_rate, 0.5);
  assert.equal(report.arms.marketplace.provider_reported_cost_usd, 0.015);
  assert.equal(report.arms.product_circle.usable_draft_write_rate, 1);
  assert.equal(report.arms.product_circle.review_minutes_per_draft, 4);
  assert.equal(report.safety.database_writes, 0);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|https:\/\//);

  const result = await runComparisonCli(
    [
      "evaluate",
      "--marketplace-run",
      marketplaceRun,
      "--product-circle-run",
      productCircleRun,
      "--output",
      join("codex-tmp", directory.split("/").at(-1), "saved.json"),
    ],
    {
      DATABASE_BACKEND: "sqlite",
      SQLITE_DATABASE_PATH: databasePath,
    },
  );
  const savedPath = resolve(result.report_path);
  const saved = await readFile(savedPath, "utf8");
  assert.equal((await stat(savedPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(saved, /PRIVATE|https:\/\//);
});

test("comparison review accepts a completed pair with no discovered sources", async () => {
  const directory = await temporaryDirectory();
  const databasePath = join(directory, "zero-source-comparison.sqlite");
  const database = openSqliteDatabase(databasePath);
  const zeroSummary = {
    sources_discovered: 0,
    sources_created: 0,
    events_written: 0,
    sources_unlinked: 0,
    provider_diagnostics: [],
    source_capture_diagnostics: [],
  };
  seedRun(database, marketplaceRun, "marketplace", { summary: zeroSummary });
  seedRun(database, productCircleRun, "product_circle", {
    summary: zeroSummary,
  });
  for (const runId of [marketplaceRun, productCircleRun]) {
    const row = database
      .prepare("select metadata from search_runs where id = ?")
      .get(runId);
    const metadata = JSON.parse(row.metadata);
    delete metadata.consulted_urls;
    database
      .prepare("update search_runs set metadata = ? where id = ?")
      .run(JSON.stringify(metadata), runId);
  }
  database.close();
  const packet = prepareComparisonReview(
    databasePath,
    marketplaceRun,
    productCircleRun,
  );
  assert.deepEqual(packet.items, []);
  assert.deepEqual(packet.judgments, []);
});

test("evaluation rejects mismatched scopes, windows, and nonterminal runs", async () => {
  for (const mismatch of [
    { productScope: "marketplace" },
    { productSearch: { limit: 2 } },
    { productStatus: "running" },
  ]) {
    const directory = await temporaryDirectory();
    const path = join(directory, "mismatch.sqlite");
    const database = openSqliteDatabase(path);
    seedRun(database, marketplaceRun, "marketplace");
    seedRun(
      database,
      productCircleRun,
      mismatch.productScope ?? "product_circle",
      {
        search: mismatch.productSearch,
        status: mismatch.productStatus,
      },
    );
    database.close();
    const evaluation = parseComparisonOptions([
      "evaluate",
      "--marketplace-run",
      marketplaceRun,
      "--product-circle-run",
      productCircleRun,
    ]);
    assert.throws(() => evaluateComparison(path, evaluation));
  }
});
