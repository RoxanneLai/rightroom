import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import https from "node:https";
import { dirname, relative, resolve } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test, { after, before, mock } from "node:test";
import { runComparisonCli } from "../../lib/ingestion/discovery-comparison.ts";
import {
  clock,
  databasePath,
  fixture,
  ingest,
  listing,
  rows,
} from "./offline-acceptance-helpers.mjs";

const marketplaceUrl = "https://luma.com/comparison-marketplace";
const productCircleUrl =
  "https://productcircle.co/events/new-york-september-2026";
let unexpectedNetworkAttempts = 0;

before(() => {
  const blocked = () => {
    unexpectedNetworkAttempts += 1;
    assert.fail("comparison rehearsal must never use a real network transport");
  };
  mock.method(globalThis, "fetch", blocked);
  mock.method(https, "request", blocked);
  mock.method(dns, "lookup", blocked);
  syncBuiltinESMExports();
});

after(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
  assert.equal(unexpectedNetworkAttempts, 0);
});

test("real scoped ingestion runs feed the read-only comparison evaluator offline", async () => {
  const path = await databasePath();
  const marketplace = fixture(marketplaceUrl);
  const productCircle = fixture(productCircleUrl, "career", " Product Circle");
  const marketplaceResult = await ingest({
    path,
    intent: "expand",
    searchFocus: "product",
    sourceScope: "marketplace",
    fixtures: [marketplace],
    listings: [
      listing(productCircleUrl, "needs_verification"),
      listing(marketplaceUrl, "needs_verification"),
    ],
    citations: [productCircleUrl, marketplaceUrl],
    candidates: [marketplace.event],
  });
  const productCircleResult = await ingest({
    path,
    intent: "expand",
    searchFocus: "product",
    sourceScope: "product_circle",
    fixtures: [productCircle],
    listings: [
      listing(marketplaceUrl, "needs_verification"),
      listing(productCircleUrl, "needs_verification"),
    ],
    citations: [marketplaceUrl, productCircleUrl],
    candidates: [productCircle.event],
  });
  assert.equal(marketplaceResult.summary.status, "succeeded");
  assert.equal(productCircleResult.summary.status, "succeeded");
  assert.deepEqual(marketplaceResult.captures, [marketplaceUrl]);
  assert.deepEqual(productCircleResult.captures, [productCircleUrl]);
  assert.equal(marketplaceResult.summary.events_written, 1);
  assert.equal(productCircleResult.summary.events_written, 1);
  const sourceRows = rows(path, "event_sources");
  assert.deepEqual(sourceRows.map((row) => row.source_name).sort(), [
    "luma.com",
    "productcircle.co",
  ]);
  assert.ok(sourceRows.every((row) => row.event_id));
  assert.ok(
    rows(path, "events").every((row) => row.publication_status === "draft"),
  );
  assert.equal(rows(path, "event_publication_reviews").length, 0);
  const runRows = rows(path, "search_runs");
  assert.deepEqual(
    runRows.map((row) => JSON.parse(row.search_parameters).source_scope).sort(),
    ["marketplace", "product_circle"],
  );

  const databaseBeforeEvaluation = await readFile(path);
  const directory = dirname(path);
  const reportPath = resolve(directory, "comparison-report.json");
  const result = await runComparisonCli(
    [
      "evaluate",
      "--marketplace-run",
      marketplaceResult.summary.run_id,
      "--product-circle-run",
      productCircleResult.summary.run_id,
      "--marketplace-review-minutes",
      "5",
      "--product-circle-review-minutes",
      "7",
      "--output",
      relative(process.cwd(), reportPath),
    ],
    { DATABASE_BACKEND: "sqlite", SQLITE_DATABASE_PATH: path },
    process.cwd(),
    clock,
  );
  assert.equal(result.mode, "offline_discovery_comparison");
  assert.equal(result.arms.marketplace.candidate_slot_fill_rate, 0.3333);
  assert.equal(result.arms.marketplace.capture_success_rate, 1);
  assert.equal(result.arms.marketplace.usable_draft_write_rate, 1);
  assert.equal(result.arms.marketplace.review_minutes_per_draft, 5);
  assert.equal(result.arms.product_circle.candidate_slot_fill_rate, 0.3333);
  assert.equal(result.arms.product_circle.capture_success_rate, 1);
  assert.equal(result.arms.product_circle.usable_draft_write_rate, 1);
  assert.equal(result.arms.product_circle.review_minutes_per_draft, 7);
  assert.equal(result.safety.network_requests, 0);
  assert.equal(result.safety.database_writes, 0);
  assert.equal(result.safety.publication_changes, 0);
  assert.deepEqual(await readFile(path), databaseBeforeEvaluation);
  const report = await readFile(reportPath, "utf8");
  assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(
    report,
    /PRIVATE_ACCEPTANCE_EVIDENCE|https:\/\/|raw_payload|research_report/,
  );
});
