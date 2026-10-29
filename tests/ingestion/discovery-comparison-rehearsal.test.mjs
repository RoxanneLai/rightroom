import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { readFile, stat, writeFile } from "node:fs/promises";
import https from "node:https";
import { dirname, relative, resolve } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test, { after, before, mock } from "node:test";
import { runComparisonCli } from "../../lib/ingestion/discovery-comparison.ts";
import { runComparisonReviewCli } from "../../lib/ingestion/discovery-comparison-review.ts";
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

  const packetPath = resolve(directory, "review-packet.json");
  const prepared = await runComparisonReviewCli(
    [
      "prepare",
      "--marketplace-run",
      marketplaceResult.summary.run_id,
      "--product-circle-run",
      productCircleResult.summary.run_id,
      "--output",
      relative(process.cwd(), packetPath),
    ],
    { DATABASE_BACKEND: "sqlite", SQLITE_DATABASE_PATH: path },
  );
  assert.equal(prepared.mode, "offline_discovery_comparison_review_prepare");
  const packet = JSON.parse(await readFile(packetPath, "utf8"));
  assert.equal((await stat(packetPath)).mode & 0o777, 0o600);
  assert.equal(packet.items.length, 2);
  assert.doesNotMatch(
    JSON.stringify(packet),
    /PRIVATE_ACCEPTANCE_EVIDENCE|raw_payload|research_report|content_text/,
  );
  const incompleteOutput = resolve(directory, "incomplete-results.json");
  await assert.rejects(
    runComparisonReviewCli(
      [
        "evaluate",
        "--input",
        relative(process.cwd(), packetPath),
        "--output",
        relative(process.cwd(), incompleteOutput),
      ],
      { DATABASE_BACKEND: "sqlite", SQLITE_DATABASE_PATH: path },
    ),
    /comparison_review_incomplete/,
  );
  const tampered = structuredClone(packet);
  tampered.items[0].event.title = "Tampered title";
  const tamperedPath = resolve(directory, "tampered-packet.json");
  await writeFile(tamperedPath, JSON.stringify(tampered, null, 2) + "\n", {
    mode: 0o600,
  });
  await assert.rejects(
    runComparisonReviewCli(
      [
        "evaluate",
        "--input",
        relative(process.cwd(), tamperedPath),
        "--output",
        relative(process.cwd(), incompleteOutput),
      ],
      { DATABASE_BACKEND: "sqlite", SQLITE_DATABASE_PATH: path },
    ),
    /comparison_review_packet_stale/,
  );
  for (const judgment of packet.judgments) {
    const marketplaceItem =
      packet.items.find((item) => item.item_id === judgment.item_id).arm ===
      "marketplace";
    judgment.relevance = "yes";
    judgment.access = "yes";
    judgment.price_fit = marketplaceItem ? "yes" : "no";
    judgment.evidence_quality = "sufficient";
    judgment.facts = {
      title: "agree",
      schedule: "agree",
      location: "agree",
      registration_identity: "agree",
    };
    judgment.disposition = marketplaceItem ? "usable" : "reject";
    judgment.rejection_reason = marketplaceItem ? null : "price";
    judgment.review_minutes = marketplaceItem ? 5 : 7;
  }
  packet.misses.push({
    arm: "marketplace",
    category: "known_event_missed",
    note: "Synthetic miss note retained only in the private packet.",
  });
  await writeFile(packetPath, JSON.stringify(packet, null, 2) + "\n", {
    mode: 0o600,
  });
  const reviewResultPath = resolve(directory, "review-results.json");
  const reviewDatabaseBefore = await readFile(path);
  const reviewed = await runComparisonReviewCli(
    [
      "evaluate",
      "--input",
      relative(process.cwd(), packetPath),
      "--output",
      relative(process.cwd(), reviewResultPath),
    ],
    { DATABASE_BACKEND: "sqlite", SQLITE_DATABASE_PATH: path },
  );
  assert.equal(reviewed.mode, "offline_discovery_comparison_review");
  assert.equal(reviewed.arms.marketplace.unique_verified_usable_leads, 1);
  assert.equal(reviewed.arms.marketplace.review_minutes, 5);
  assert.deepEqual(reviewed.arms.marketplace.miss_categories, {
    known_event_missed: 1,
  });
  assert.equal(reviewed.arms.product_circle.unique_verified_usable_leads, 0);
  assert.equal(reviewed.arms.product_circle.rejection_reasons.price, 1);
  assert.equal(reviewed.arms.product_circle.review_minutes, 7);
  assert.equal(
    reviewed.proposed_yield_observation.marketplace_meets_count,
    false,
  );
  assert.deepEqual(await readFile(path), reviewDatabaseBefore);
  const reviewResult = await readFile(reviewResultPath, "utf8");
  assert.equal((await stat(reviewResultPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(
    reviewResult,
    /comparison-marketplace|new-york-september|Synthetic miss|https:\/\//,
  );
});
