import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import https from "node:https";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { executeSqliteInspection } from "../../lib/ingestion/inspection.ts";
import { executeSqliteReview } from "../../lib/review/repository.ts";
import { buildReviewReport } from "../../lib/review/report.ts";
import { loadDashboard } from "../../lib/dashboard/repository.ts";
import { url } from "./helpers.mjs";
import {
  clock,
  privateMarker,
  fixture,
  manifest,
  listing,
  databasePath,
  rows,
  ingest,
} from "./offline-acceptance-helpers.mjs";

let unexpectedNetworkAttempts = 0;

before(() => {
  const blocked = () => {
    unexpectedNetworkAttempts += 1;
    assert.fail("offline acceptance must never reach a real network transport");
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

function review(path, source, command = "preview", approval = {}) {
  return executeSqliteReview(
    {
      command,
      eventId: source.event_id,
      sourceId: source.id,
      approved: false,
      database: "postgres",
      ...approval,
    },
    path,
    clock,
  );
}

function feed(path, career = true) {
  return loadDashboard({
    env: { DATABASE_BACKEND: "sqlite", SQLITE_DATABASE_PATH: path },
    now: clock,
    career,
    fetch: async () => assert.fail("SQLite dashboard must not use the network"),
  });
}

for (const profile of ["founder", "career"]) {
  test(`offline ${profile}: dispositions → capture → original evidence → private SQLite draft`, async () => {
    const path = await databasePath();
    const lead = fixture(url, profile);
    const background = "https://luma.com/rejected-background";
    const uncited = "https://luma.com/uncited-lead";
    const listings = [
      listing(background, "rejected"),
      listing(uncited),
      listing(url, "needs_verification"),
    ];
    const original = structuredClone(lead.event);
    const { summary, requests, captures } = await ingest({
      path,
      profile,
      fixtures: [lead],
      listings,
      citations: [background, url],
      content: manifest(
        listings,
        `### 1. Misleading legacy result\n${background}`,
      ),
    });
    assert.equal(summary.status, "succeeded");
    assert.equal(summary.events_written, 1);
    assert.deepEqual(captures, [url]);
    assert.equal(requests.length, 2);
    assert.deepEqual(
      summary.provider_diagnostics.map((item) => item.phase),
      ["research", "extraction"],
    );
    const [source] = rows(path, "event_sources");
    const [event] = rows(path, "events");
    const payload = JSON.parse(source.raw_payload);
    assert.deepEqual(payload.candidate, original);
    assert.deepEqual(lead.event, original);
    assert.ok(
      payload.normalization_notes.includes(
        "event_format_quote_json_escape_normalized",
      ),
    );
    assert.match(source.content_text, /Structured event data/);
    assert.match(source.content_hash, /^[a-f0-9]{64}$/);
    assert.equal(payload.source_page.text, source.content_text);
    assert.equal(payload.source_page.fetched_at, clock.toISOString());
    assert.equal(event.publication_status, "draft");
    assert.equal(event.price_amount_cents, null);
    assert.equal(event.currency_code, null);
    assert.equal(event.registration_status, "unknown");
    assert.equal(event.venue_name, null);
    const metadata = JSON.parse(rows(path, "search_runs")[0].metadata);
    assert.equal(metadata.research.selection_format, "manifest_v1");
    assert.equal(metadata.research.rejected_listing_count, 1);
    assert.equal(metadata.research.verification_lead_count, 1);
    const before = rows(path, "search_runs");
    const inspection = executeSqliteInspection(summary.run_id, path);
    assert.equal(inspection.run.status, "succeeded");
    assert.equal(inspection.sources[0].event_id, event.id);
    assert.doesNotMatch(
      JSON.stringify(inspection),
      /PRIVATE_ACCEPTANCE_EVIDENCE|raw_payload|content_text|Misleading legacy/,
    );
    assert.deepEqual(rows(path, "search_runs"), before);
    assert.ok(
      buildReviewReport(review(path, source), clock).warnings.some((warning) =>
        warning.includes("extra JSON escape layer"),
      ),
    );
    assert.equal((await feed(path, profile === "career")).status, "empty");
    assert.equal(rows(path, "event_publication_reviews").length, 0);
  });
}

test("offline refresh deduplicates and preserves successful evidence after a failed capture", async () => {
  const path = await databasePath();
  await ingest({ path });
  const [original] = rows(path, "event_sources");
  await ingest({ path });
  assert.equal(rows(path, "events").length, 1);
  assert.equal(rows(path, "event_sources").length, 1);
  assert.equal(rows(path, "event_sources")[0].id, original.id);
  const before = rows(path, "event_sources")[0];
  const events = rows(path, "events");
  const failed = await ingest({ path, captureStatus: 403 });
  assert.equal(failed.summary.status, "partial");
  assert.deepEqual(failed.summary.errors, ["source_capture_http_error"]);
  assert.equal(
    failed.requests.length,
    1,
    "failed capture must skip extraction and repair",
  );
  const [after] = rows(path, "event_sources");
  for (const key of [
    "id",
    "event_id",
    "content_text",
    "content_hash",
    "raw_payload",
    "fetched_at",
    "first_seen_at",
    "discovered_by_run_id",
  ]) {
    assert.equal(after[key], before[key], key);
  }
  assert.equal(after.last_attempt_error, "source_capture_http_error");
  assert.deepEqual(rows(path, "events"), events);
  const preview = review(path, after);
  assert.throws(
    () =>
      review(path, after, "publish", {
        approved: true,
        token: preview.review_token,
      }),
    /Successful source evidence is required/,
  );
  assert.equal(rows(path, "event_publication_reviews").length, 0);
});

test("offline approval is explicit and revision-bound; published fields and history survive refresh", async () => {
  const path = await databasePath();
  await ingest({ path });
  const [source] = rows(path, "event_sources");
  const stale = review(path, source);
  assert.throws(
    () => review(path, source, "publish", { token: stale.review_token }),
    /Explicit publication approval is required/,
  );
  await ingest({ path, fixtures: [fixture(url, "career", " revised")] });
  assert.throws(
    () =>
      review(path, source, "publish", {
        approved: true,
        token: stale.review_token,
      }),
    /event or evidence changed/,
  );
  assert.equal(rows(path, "event_publication_reviews").length, 0);
  assert.equal((await feed(path)).status, "empty");
  const fresh = review(path, source);
  // Publication is deliberately exercised only for a synthetic event in this temporary DB.
  review(path, source, "publish", {
    approved: true,
    token: fresh.review_token,
  });
  const published = rows(path, "events");
  const history = rows(path, "event_publication_reviews");
  assert.equal(history.length, 1);
  const dashboard = await feed(path);
  assert.equal(dashboard.status, "ready");
  assert.equal(dashboard.events.length, 1);
  assert.doesNotMatch(
    JSON.stringify(dashboard),
    /PRIVATE_ACCEPTANCE_EVIDENCE|raw_payload|source_page|normalization_notes|review_token/,
  );
  assert.ok(
    JSON.stringify(history).includes(privateMarker),
    "evidence remains in private approval history only",
  );
  const refreshed = await ingest({
    path,
    fixtures: [fixture(url, "career", " not approved")],
  });
  assert.equal(refreshed.summary.events_written, 0);
  assert.deepEqual(rows(path, "events"), published);
  assert.deepEqual(rows(path, "event_publication_reviews"), history);
  assert.deepEqual(await feed(path), dashboard);
});

test("offline expansion excludes known aliases locally before capturing a new verification lead", async () => {
  const path = await databasePath();
  await ingest({ path });
  const freshUrl = "https://luma.com/new-synthetic-lead";
  const expanded = await ingest({
    path,
    intent: "expand",
    fixtures: [fixture(freshUrl)],
    listings: [
      listing("https://lu.ma/founder-test?utm_source=ignored"),
      listing(freshUrl, "needs_verification"),
    ],
  });
  assert.equal(expanded.summary.status, "succeeded");
  assert.equal(expanded.summary.discovery_exclusions.linked_source_count, 1);
  assert.equal(expanded.summary.sources_discovered, 1);
  assert.deepEqual(expanded.captures, [freshUrl]);
  assert.equal(expanded.requests.length, 2);
  assert.equal(rows(path, "events").length, 2);
  assert.equal(rows(path, "event_sources").length, 2);
  assert.equal((await feed(path)).status, "empty");
});

test("offline invalid and empty selections stop before any capture or extraction", async () => {
  for (const [content, expectedStatus, expectedErrors] of [
    [
      `No qualifying results. Background: ${url}`,
      "failed",
      ["invalid_research_selection"],
    ],
    [
      `### 1. Fallback\n${url}\n\`\`\`rightroom-discovery-v1\n{bad}\n\`\`\``,
      "failed",
      ["invalid_research_selection"],
    ],
    [manifest([]), "succeeded", []],
    [manifest([listing(url, "rejected")]), "succeeded", []],
  ]) {
    const path = await databasePath();
    const result = await ingest({ path, content });
    assert.equal(result.summary.status, expectedStatus);
    assert.deepEqual(result.summary.errors, expectedErrors);
    assert.equal(result.requests.length, 1);
    assert.deepEqual(result.captures, []);
    assert.equal(rows(path, "events").length, 0);
    assert.equal(rows(path, "event_sources").length, 0);
    assert.equal(rows(path, "search_runs")[0].status, expectedStatus);
  }
});

test("offline normalization isolates an ungrounded quote and an already-started sibling", async () => {
  const path = await databasePath();
  const bad = fixture("https://luma.com/bad-quote");
  bad.event.event_format.quote = JSON.stringify(
    bad.event.event_format.quote,
  ).slice(1, -1);
  const started = fixture("https://luma.com/started-event");
  started.event.starts_at.value = "2026-09-01T00:00:00-04:00";
  const result = await ingest({ path, fixtures: [fixture(), bad, started] });
  assert.equal(result.summary.status, "partial");
  assert.equal(result.summary.events_written, 1);
  assert.equal(result.summary.sources_unlinked, 2);
  assert.deepEqual(
    new Set(result.summary.errors),
    new Set(["incomplete_event", "event_already_started"]),
  );
  assert.equal(
    result.requests.length,
    2,
    "schema-valid candidates do not trigger repair or retry",
  );
  assert.equal(rows(path, "events").length, 1);
  assert.equal(
    rows(path, "event_sources").filter((source) => source.event_id).length,
    1,
  );
  assert.equal((await feed(path)).status, "empty");
});

test("offline bounded repair reaches SQLite only when it preserves captured candidate facts", async () => {
  for (const changesScalar of [false, true]) {
    const path = await databasePath();
    const lead = fixture();
    const repaired = structuredClone(lead.event);
    if (changesScalar) repaired.title.value = "Invented replacement title";
    const result = await ingest({
      path,
      fixtures: [lead],
      extraction: JSON.stringify({
        candidates: [{ ...lead.event, unfamiliar: null }],
      }),
      repair: JSON.stringify({ candidates: [repaired] }),
    });
    assert.equal(
      result.requests.length,
      3,
      "one research, one extraction, at most one repair",
    );
    assert.deepEqual(
      result.summary.provider_diagnostics.map((item) => item.phase),
      ["research", "extraction", "repair"],
    );
    assert.equal(rows(path, "events").length, changesScalar ? 0 : 1);
    const [source] = rows(path, "event_sources");
    if (changesScalar) {
      assert.deepEqual(result.summary.errors, ["invalid_repair_output"]);
      assert.equal(source.event_id, null);
      assert.equal(
        result.summary.provider_diagnostics[2].repair_validation,
        "scalar_preservation_failed",
      );
    } else {
      assert.equal(result.summary.status, "succeeded");
      assert.equal(
        result.summary.provider_diagnostics[2].repair_validation,
        "accepted",
      );
      assert.deepEqual(JSON.parse(source.raw_payload).candidate, lead.event);
    }
    assert.equal((await feed(path)).status, "empty");
    assert.equal(rows(path, "event_publication_reviews").length, 0);
  }
});
