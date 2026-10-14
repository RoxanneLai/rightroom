import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  evaluateIngestionHistory,
  loadEvaluationInput,
  parseEvaluationOptions,
  parseSafeRunSummary,
  runEvaluationCli,
} from "../../lib/ingestion/evaluation.ts";
import { openSqliteDatabase } from "../../lib/storage/sqlite.ts";

const firstRun = "90000000-0000-4000-8000-000000000011";
const secondRun = "90000000-0000-4000-8000-000000000012";
const eventId = "80000000-0000-4000-8000-000000000011";

async function temporaryDirectory() {
  await mkdir("codex-tmp", { recursive: true });
  return mkdtemp("codex-tmp/evaluation-test-");
}

function diagnostic(phase, cost = 0.01) {
  return {
    phase,
    extraction_shape: phase === "extraction" ? "invalid" : null,
    extraction_candidate_format: null,
    repair_validation: phase === "repair" ? "accepted" : null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      reasoning_tokens: 10,
      total_tokens: 150,
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
    provider_diagnostics: [diagnostic("research"), diagnostic("extraction")],
    ...overrides,
  };
}

function evaluationInput() {
  return {
    runs: [
      {
        id: firstRun,
        status: "succeeded",
        startedAt: "2026-09-26T12:00:00.000Z",
        requestedLimit: 3,
        sourcesDiscovered: 2,
        sourcesCreated: 2,
        sourcesUpdated: 0,
        runErrorCodes: [],
        sourceFailureCounts: {},
        summary: parseSafeRunSummary(
          summary(firstRun, {
            sources_unlinked: 0,
            provider_diagnostics: [
              diagnostic("research"),
              diagnostic("extraction"),
              diagnostic("repair", 0.002),
            ],
          }),
        ),
      },
      {
        id: secondRun,
        status: "partial",
        startedAt: "2026-09-26T13:00:00.000Z",
        requestedLimit: 3,
        sourcesDiscovered: 1,
        sourcesCreated: 1,
        sourcesUpdated: 0,
        runErrorCodes: ["invalid_extraction_shape"],
        sourceFailureCounts: { invalid_extraction_shape: 1 },
        summary: parseSafeRunSummary(
          summary(secondRun, {
            events_written: 0,
            sources_unlinked: 1,
            errors: ["invalid_extraction_shape"],
            provider_diagnostics: [
              diagnostic("research"),
              diagnostic("extraction"),
            ],
          }),
        ),
      },
      {
        id: "90000000-0000-4000-8000-000000000013",
        status: "running",
        startedAt: "2026-09-26T14:00:00.000Z",
        requestedLimit: 3,
        sourcesDiscovered: 0,
        sourcesCreated: 0,
        sourcesUpdated: 0,
        runErrorCodes: [],
        sourceFailureCounts: {},
        summary: null,
      },
    ],
    databaseState: {
      events: 2,
      nonfixtureEvents: 1,
      sources: 3,
      linkedSources: 1,
      unlinkedSources: 2,
      publicationStatuses: { draft: 1, published: 1 },
      sourceErrorCounts: { none: 1, invalid_extraction_shape: 2 },
      sourcePortfolio: {
        meetup: {
          consultations: 4,
          consultationRuns: 2,
          storedSources: 4,
          linkedSources: 3,
          latestErrorSources: 1,
        },
        luma: {
          consultations: 3,
          consultationRuns: 2,
          storedSources: 3,
          linkedSources: 1,
          latestErrorSources: 2,
        },
        first_party_or_other: {
          consultations: 1,
          consultationRuns: 1,
          storedSources: 1,
          linkedSources: 1,
          latestErrorSources: 0,
        },
      },
    },
    checkpoints: {
      filesRead: 2,
      invalidFiles: 0,
      matchedRuns: 2,
      unmatchedRuns: 0,
    },
  };
}

function seedDatabase(path) {
  const database = openSqliteDatabase(path);
  const startedAt = "2026-09-26T12:00:00.000Z";
  database
    .prepare(
      `insert into search_runs (
        id, agent_name, provider, search_parameters, status, started_at,
        completed_at, sources_discovered, sources_created, sources_updated,
        error_message, metadata, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      firstRun,
      "founder-radar-discovery",
      "openrouter-web-search",
      JSON.stringify({ limit: 3 }),
      "succeeded",
      startedAt,
      startedAt,
      3,
      3,
      0,
      null,
      JSON.stringify({
        summary: summary(firstRun, {
          sources_discovered: 3,
          sources_created: 3,
          sources_unlinked: 2,
          source_capture_diagnostics: [
            {
              source_id: "70000000-0000-4000-8000-000000000012",
              status: "failed",
              error_code: "source_capture_redirect_limit",
            },
            "PRIVATE-MALFORMED-CAPTURE-DIAGNOSTIC",
          ],
        }),
        candidate_failures: [
          {
            source_id: "70000000-0000-4000-8000-000000000013",
            error_code: "invalid_event_timezone",
            private_fields: "PRIVATE-CANDIDATE-CONTENT",
          },
          "PRIVATE-MALFORMED-CANDIDATE-FAILURE",
        ],
        consulted_urls: [
          "https://www.meetup.com/example/events/1",
          "https://community.example.com/events/1",
        ],
        research_report: "PRIVATE-RESEARCH-CONTENT",
      }),
      startedAt,
      startedAt,
    );
  database
    .prepare(
      `insert into search_runs (
        id, agent_name, provider, search_parameters, status, started_at,
        completed_at, metadata, created_at, updated_at
      ) values (?, 'founder-radar-fixture-loader', 'fixture', '{}',
        'succeeded', ?, ?, '{}', ?, ?)`,
    )
    .run(secondRun, startedAt, startedAt, startedAt, startedAt);
  database
    .prepare(
      `insert into events (
        id, title, starts_at, publication_status, is_fixture, first_seen_at,
        last_seen_at, created_at, updated_at
      ) values (?, 'Synthetic evaluation event', ?, 'draft', 0, ?, ?, ?, ?)`,
    )
    .run(eventId, startedAt, startedAt, startedAt, startedAt, startedAt);
  database
    .prepare(
      `insert into event_sources (
        id, event_id, discovered_by_run_id, source_name, source_url,
        first_seen_at, last_seen_at, last_attempt_error, raw_payload,
        created_at, updated_at
      ) values (?, ?, ?, 'Meetup', 'https://www.meetup.com/example/events/1',
        ?, ?, ?, '{}', ?, ?)`,
    )
    .run(
      "70000000-0000-4000-8000-000000000011",
      eventId,
      firstRun,
      startedAt,
      startedAt,
      "RAW PRIVATE PROVIDER MESSAGE",
      startedAt,
      startedAt,
    );
  database.close();
}

test("evaluation help and malformed paths fail before database access", async () => {
  assert.equal(parseEvaluationOptions([]).command, "help");
  assert.equal(parseEvaluationOptions(["run"]).command, "run");
  for (const args of [
    ["evaluate"],
    ["run", "--unknown", "value"],
    ["run", "--output"],
    ["run", "--output", "report.json"],
    ["run", "--output", "codex-tmp/report.txt"],
    ["run", "--output", "codex-tmp/a.json", "--output", "codex-tmp/b.json"],
  ])
    assert.throws(() => parseEvaluationOptions(args));
  await assert.rejects(
    runEvaluationCli(["run"], { DATABASE_BACKEND: "supabase" }),
    /supports SQLite only/,
  );
});

test("safe summary parsing allowlists aggregate fields and rejects private strings", () => {
  const parsed = parseSafeRunSummary({
    ...summary(firstRun),
    errors: ["safe_code", "Raw provider message with spaces"],
    provider_diagnostics: [
      {
        ...diagnostic("repair"),
        extraction_shape: "candidate_array",
        private_prompt: "DO NOT RETURN THIS",
        usage: { ...diagnostic("repair").usage, cost: "not-a-number" },
      },
    ],
    research_report: "PRIVATE-RESEARCH-CONTENT",
  });
  assert.deepEqual(parsed.errors, ["safe_code"]);
  assert.equal(parsed.diagnostics[0].cost, null);
  assert.ok(!JSON.stringify(parsed).includes("PRIVATE"));
  assert.ok(!JSON.stringify(parsed).includes("DO NOT"));
});

test("aggregate evaluation identifies breadth, repair, cost, and interrupted-run gaps", () => {
  const report = evaluateIngestionHistory(evaluationInput());
  assert.equal(report.coverage.discovery_runs, 3);
  assert.equal(report.coverage.terminal_runs, 2);
  assert.equal(report.coverage.running_runs, 1);
  assert.equal(report.discovery.requested_candidate_slots, 6);
  assert.equal(report.discovery.discovered_candidates_within_limit, 3);
  assert.equal(report.discovery.candidate_slot_fill_rate, 0.5);
  assert.equal(report.outcomes.usable_draft_writes, 1);
  assert.deepEqual(report.outcomes.loss_category_counts, {
    extraction_or_validation: 1,
  });
  assert.deepEqual(report.outcomes.source_outcome_funnel, {
    discovered_source_observations: 3,
    usable_draft_writes: 1,
    retained_links_without_draft_write: 1,
    unlinked_source_observations_after_run: 1,
    observations_without_safe_summary: 0,
    draft_write_rate_per_discovered_source: 0.3333,
    source_failure_observations: 1,
    source_failure_code_counts: { invalid_extraction_shape: 1 },
    source_failure_category_counts: { extraction_or_validation: 1 },
  });
  assert.equal(report.compatibility.repair_runs, 1);
  assert.equal(report.compatibility.repair_run_rate, 0.5);
  assert.equal(report.compatibility.diagnostic_covered_runs, 2);
  assert.equal(report.recent_cohort.runs, 2);
  assert.deepEqual(report.recent_cohort.loss_category_counts, {
    extraction_or_validation: 1,
  });
  assert.equal(report.usage.provider_reported_cost_usd, 0.042);
  assert.equal(report.usage.cost_per_usable_draft_write_usd, 0.042);
  assert.equal(report.source_portfolio.total_consultations, 8);
  assert.equal(report.source_portfolio.marketplace_consultation_share, 0.875);
  assert.equal(
    report.source_portfolio.family_metrics.luma.linked_source_rate,
    0.3333,
  );
  assert.deepEqual(
    report.recommendations.map((item) => item.focus),
    [
      "close_interrupted_runs",
      "source_failure_replay",
      "discovery_recall",
      "source_family_conversion",
      "source_portfolio_diversity",
      "structured_output_compatibility",
    ],
  );
  assert.match(
    report.recommendations[1].next_experiment,
    /replay preserved evidence/,
  );
  assert.equal(
    report.recommendations[3].evidence,
    "luma linked 33.3% of its stored source rows to events.",
  );
});

test("SQLite evaluation is read-only, merges safe checkpoints, and writes a private report", async () => {
  const directory = await temporaryDirectory();
  const databasePath = join(directory, "history.sqlite");
  const outputPath = join(directory, "report.json");
  seedDatabase(databasePath);
  await writeFile(
    join(directory, `ingestion-${firstRun}.json`),
    JSON.stringify({
      ...summary(firstRun),
      provider_diagnostics: [
        diagnostic("research"),
        diagnostic("extraction"),
        diagnostic("repair", 0.002),
      ],
      private_source_content: "PRIVATE-CHECKPOINT-CONTENT",
    }),
  );
  await writeFile(
    join(directory, "ingestion-90000000-0000-4000-8000-000000000099.json"),
    "not-json",
  );
  const input = await loadEvaluationInput(databasePath, directory);
  assert.equal(input.runs.length, 1);
  assert.equal(input.runs[0].summary.diagnostics.length, 3);
  assert.deepEqual(input.runs[0].sourceFailureCounts, {
    invalid_event_timezone: 1,
    source_capture_redirect_limit: 1,
  });
  assert.equal(input.checkpoints.filesRead, 2);
  assert.equal(input.checkpoints.invalidFiles, 1);
  assert.equal(input.checkpoints.matchedRuns, 1);
  assert.deepEqual(input.databaseState.sourceErrorCounts, { unknown: 1 });
  assert.deepEqual(input.databaseState.sourcePortfolio, {
    first_party_or_other: {
      consultations: 1,
      consultationRuns: 1,
      storedSources: 0,
      linkedSources: 0,
      latestErrorSources: 0,
    },
    meetup: {
      consultations: 1,
      consultationRuns: 1,
      storedSources: 1,
      linkedSources: 1,
      latestErrorSources: 1,
    },
  });
  const result = await runEvaluationCli(
    ["run", "--checkpoints", directory, "--output", outputPath],
    {
      DATABASE_BACKEND: "sqlite",
      SQLITE_DATABASE_PATH: databasePath,
    },
  );
  const reportText = await readFile(outputPath, "utf8");
  const information = await stat(outputPath);
  assert.equal(result.safety.database_writes, 0);
  assert.equal(information.mode & 0o777, 0o600);
  assert.ok(!reportText.includes("PRIVATE"));
  assert.ok(!reportText.includes(firstRun));
  assert.ok(!reportText.includes("meetup.com"));
  const database = openSqliteDatabase(databasePath);
  assert.equal(
    database.prepare("select count(*) count from search_runs").get().count,
    2,
  );
  database.close();
});
