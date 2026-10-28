import assert from "node:assert/strict";
import test from "node:test";
import { publicListingUrl } from "../../lib/public-listing-url.ts";
import { normalizePublishedEvents } from "../../lib/dashboard/normalize.ts";
import { buildReviewReport } from "../../lib/review/report.ts";
import { parseReviewOptions } from "../../lib/review/options.ts";
import { reviewStatement, executeReview } from "../../lib/review/repository.ts";
import { runReviewCli } from "../../lib/review/cli.ts";
import { now, publishedRow } from "../dashboard/helpers.mjs";

const eventId = "40000000-0000-4000-8000-000000000001";
const sourceId = "60000000-0000-4000-8000-000000000001";
const token = "a".repeat(64);

function snapshot(event = {}, source = {}) {
  return {
    event: publishedRow({ publication_status: "draft", ...event }),
    sources: [
      {
        id: sourceId,
        event_id: eventId,
        source_url:
          "https://lu.ma/synthetic-review?token=private&utm_source=test#private",
        content_text: "PRIVATE MODEL RESEARCH",
        fetched_at: now.toISOString(),
        last_attempt_error: null,
        raw_payload: { private: true },
        ...source,
      },
    ],
    selected_source_id: sourceId,
    public_registration_url: "https://luma.com/synthetic-review",
    review_token: token,
  };
}

test("format spelling provenance stays private and is disclosed in operator review without changing public cards", () => {
  const report = buildReviewReport(
    snapshot(
      {},
      {
        raw_payload: {
          normalization_notes: ["event_format_normalized_in_person"],
          candidate: {
            event_format: {
              value: "in_person",
              quote: "PRIVATE PHYSICAL ATTENDANCE QUOTE",
            },
          },
        },
      },
    ),
    now,
  );
  assert.deepEqual(report.blockers, []);
  assert.match(report.warnings.join(" "), /in_person.*in-person/);
  assert.match(report.warnings.join(" "), /check physical attendance/);
  assert.deepEqual(
    report.publicPreview,
    buildReviewReport(snapshot(), now).publicPreview,
  );
  assert.doesNotMatch(
    JSON.stringify(report.publicPreview),
    /in_person|normalization_notes|PRIVATE PHYSICAL/,
  );
});

test("attendance-mode escape provenance is disclosed privately without exposing original quotes", () => {
  const report = buildReviewReport(
    snapshot(
      {},
      {
        raw_payload: {
          normalization_notes: ["event_format_quote_json_escape_normalized"],
          candidate: {
            event_format: {
              value: "in-person",
              quote: "PRIVATE ESCAPED ATTENDANCE",
            },
          },
        },
      },
    ),
    now,
  );
  assert.deepEqual(report.blockers, []);
  assert.match(
    report.warnings.join(" "),
    /extra JSON escape layer.*exact source text/,
  );
  assert.match(
    report.warnings.join(" "),
    /check physical attendance before approval/,
  );
  assert.deepEqual(
    report.publicPreview,
    buildReviewReport(snapshot(), now).publicPreview,
  );
  assert.doesNotMatch(
    JSON.stringify(report.publicPreview),
    /normalization_notes|PRIVATE ESCAPED/,
  );
});

test("Eastern label provenance is disclosed privately without changing public cards", () => {
  const report = buildReviewReport(
    snapshot(
      {},
      {
        raw_payload: {
          normalization_notes: ["timezone_normalized_eastern"],
          candidate: {
            time_zone: { value: "ET", quote: "PRIVATE TIME QUOTE" },
          },
        },
      },
    ),
    now,
  );
  assert.deepEqual(report.blockers, []);
  assert.match(
    report.warnings.join(" "),
    /Eastern.*America\/New_York.*date-correct/,
  );
  assert.deepEqual(
    report.publicPreview,
    buildReviewReport(snapshot(), now).publicPreview,
  );
  assert.doesNotMatch(
    JSON.stringify(report.publicPreview),
    /normalization_notes|PRIVATE TIME QUOTE/,
  );
});

test("public URLs use a strict listing allowlist and never retain private parameters", () => {
  for (const [input, expected] of [
    [
      "https://www.lu.ma/example/?token=secret#fragment",
      "https://luma.com/example",
    ],
    [
      "https://www.meetup.com/test-group/events/123/?token=secret",
      "https://meetup.com/test-group/events/123",
    ],
    [
      "https://www.eventbrite.com/e/test-tickets-123?discount=secret",
      "https://eventbrite.com/e/test-tickets-123",
    ],
    [
      "https://www.productcircle.co/events/new-york-november-2026/?token=secret#fragment",
      "https://productcircle.co/events/new-york-november-2026",
    ],
  ])
    assert.equal(publicListingUrl(input), expected);
  for (const input of [
    null,
    "",
    "https://luma.com/login",
    "javascript:alert(1)",
    "http://luma.com/test",
    "https://evil.test/test",
    "https://luma.com.evil.test/test",
    "https://luma.com:443/test",
    "https://u:p@luma.com/test",
    "https://luma.com/../test",
    "https://luma.com/%74est",
    "https://luma.com/test\\bad",
    "https://luma.com/test\n",
    "https://luma.com/test?x=\u001b[31m",
    "https://meetup.com/test",
    "https://eventbrite.com/e/test",
    "https://productcircle.co/events",
    "https://productcircle.co/events/new-york-2026",
    "https://productcircle.co/events/new-york-summer-2026",
    "https://productcircle.co/events/New-York-November-2026",
    "https://productcircle.co/events/new-york-november-2026/extra",
    "https://luma.com/" + "a".repeat(2048),
  ])
    assert.equal(publicListingUrl(input), null, String(input));
});

test("public projection accepts only already-canonical reviewed links and never copies source URLs", () => {
  for (const value of [
    undefined,
    null,
    "javascript:alert(1)",
    "https://luma.com/test?secret=private",
    "https://lu.ma/test",
    "https://evil.test/test",
  ]) {
    const [card] = normalizePublishedEvents(
      [
        publishedRow({
          public_registration_url: value,
          source_url: "https://luma.com/private",
        }),
      ],
      now,
    );
    assert.equal(card.registrationUrl, null);
  }
  assert.equal(
    normalizePublishedEvents(
      [publishedRow({ public_registration_url: "https://luma.com/test" })],
      now,
    )[0].registrationUrl,
    "https://luma.com/test",
  );
});

test("review reports separate private evidence from the exact shared public projection", () => {
  const report = buildReviewReport(snapshot(), now);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.approval.token, token);
  assert.match(report.warnings.join(" "), /model-generated|Organizer|Price/);
  assert.match(JSON.stringify(report.sources), /PRIVATE MODEL RESEARCH/);
  const expected = normalizePublishedEvents(
    [
      publishedRow({
        public_registration_url: "https://luma.com/synthetic-review",
      }),
    ],
    now,
  )[0];
  assert.deepEqual(report.publicPreview.card, expected);
  assert.doesNotMatch(
    JSON.stringify(report.publicPreview),
    /PRIVATE|raw_payload|content_text|token=|selected_source_id/,
  );
  assert.equal(report.publicPreview.price, "Price not listed");
});

test("review blocks unsupported events, unusable evidence and mismatched sources without minting approval", () => {
  for (const event of [
    { is_fixture: true },
    { publication_status: "published" },
    { publication_status: "archived" },
    { starts_at: now.toISOString() },
    { starts_at: "2020-01-01T00:00:00Z" },
    { starts_at: "2030-01-01T00:00:00Z" },
    { city: "Boston" },
    { event_format: "virtual" },
    { registration_status: "cancelled" },
    { title: "" },
    { ends_at: "2020-01-01T00:00:00Z" },
  ]) {
    const report = buildReviewReport(snapshot(event), now);
    assert.ok(report.blockers.length, JSON.stringify(event));
    assert.equal(report.approval, null);
  }
  for (const source of [
    { event_id: "40000000-0000-4000-8000-000000000002" },
    { content_text: " " },
    { fetched_at: null },
    { fetched_at: "invalid" },
    { last_attempt_error: "provider_failure" },
    { source_url: "https://evil.test/event" },
  ]) {
    const report = buildReviewReport(snapshot({}, source), now);
    assert.ok(report.blockers.length);
    assert.equal(report.approval, null);
  }
});

test("unknowns, free prices, old evidence and non-open registration have honest warnings", () => {
  const report = buildReviewReport(
    snapshot(
      {
        price_amount_cents: 0,
        currency_code: "USD",
        networking_score: 0,
        registration_status: "waitlist",
      },
      { fetched_at: "2026-08-01T00:00:00Z" },
    ),
    now,
  );
  assert.equal(report.publicPreview.price, "Free");
  assert.match(report.warnings.join(" "), /seven days|waitlist/);
  assert.doesNotMatch(
    report.warnings.join(" "),
    /Price is not listed|Networking score is not listed/,
  );
  assert.equal(report.approval.token, token);
});

test("CLI is offline by default and rejects ambiguous or incomplete approvals before connecting", async () => {
  const noConnection = async () => {
    assert.fail("must not connect");
  };
  assert.match((await runReviewCli([], noConnection)).help, /read-only/);
  for (const args of [
    ["publish"],
    ["publish", "--event", eventId, "--source", sourceId],
    ["publish", "--event", eventId, "--source", sourceId, "--approve"],
    ["inspect", "--event", eventId, "--approve"],
    ["list", "--database", "production"],
    ["list", "--database", "postgres", "--database", "postgres"],
    ["list", "--after", "'; delete from events; --"],
    ["list", "--scope", "all"],
    ["preview", "--event", eventId],
    ["list", "--unknown"],
  ])
    await assert.rejects(runReviewCli(args, noConnection));
});

test("CLI inspect and preview are read-only; publishing passes the exact reviewed token once", async () => {
  const inspected = await runReviewCli(
    ["inspect", "--event", eventId],
    async (options) => {
      assert.doesNotMatch(
        reviewStatement(options),
        /publish_reviewed_event|insert|update|delete/i,
      );
      return {
        ...snapshot(),
        selected_source_id: null,
        public_registration_url: null,
      };
    },
    now,
  );
  assert.equal(inspected.approval, null);
  const preview = await runReviewCli(
    ["preview", "--event", eventId, "--source", sourceId],
    async () => snapshot(),
    now,
  );
  assert.equal(preview.approval.token, token);
  let calls = 0;
  const result = await runReviewCli(
    [
      "publish",
      "--event",
      eventId,
      "--source",
      sourceId,
      "--token",
      token,
      "--approve",
    ],
    async (options) => {
      calls++;
      assert.equal(options.token, token);
      assert.equal(options.database, "postgres");
      assert.match(reviewStatement(options), /publish_reviewed_event/);
      return { publication_status: "published" };
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.publication_status, "published");
});

test("draft lists are capped and have a deterministic next-page cursor", async () => {
  const rows = Array.from({ length: 21 }, (_, n) => ({
    id: `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title: "Synthetic draft",
  }));
  const list = await runReviewCli(
    ["list"],
    async (options) => {
      assert.equal(options.listScope, "upcoming");
      assert.equal(options.asOf, now.toISOString());
      return rows;
    },
    now,
  );
  assert.equal(list.scope, "upcoming");
  assert.equal(list.asOf, now.toISOString());
  assert.equal(list.drafts.length, 20);
  assert.equal(list.nextCursor, rows[19].id);
  assert.match(
    reviewStatement(parseReviewOptions(["list", "--after", list.nextCursor])),
    /order by id limit 21/,
  );
  const upcoming = reviewStatement({
    ...parseReviewOptions(["list"]),
    asOf: now.toISOString(),
  });
  const expired = reviewStatement({
    ...parseReviewOptions(["list", "--scope", "expired"]),
    asOf: now.toISOString(),
  });
  assert.match(upcoming, /starts_at > .*::timestamptz/);
  assert.match(expired, /starts_at <= .*::timestamptz/);
});

test("review transport rejects remote Docker and pins local read-only transactions with timeouts", async () => {
  const options = parseReviewOptions(["inspect", "--event", eventId]);
  let calls = 0;
  await assert.rejects(
    executeReview(options, async () => {
      calls++;
      return "tcp://remote.example:2376";
    }),
    /local Docker/,
  );
  assert.equal(calls, 1);
  const localCalls = [];
  const result = await executeReview(options, async (args, input) => {
    localCalls.push({ args, input });
    return args[0] === "context" ? "unix:///local/docker.sock" : "{}";
  });
  assert.deepEqual(result, {});
  assert.deepEqual(localCalls[1].args.slice(0, 5), [
    "--host",
    "unix:///local/docker.sock",
    "exec",
    "-i",
    "supabase_db_founder-radar",
  ]);
  assert.match(localCalls[1].input, /^begin read only;/);
  assert.match(localCalls[1].input, /statement_timeout = '10s'/);
  assert.match(localCalls[1].input, /lock_timeout = '5s'/);
  assert.doesNotMatch(localCalls[1].input, /publish_reviewed_event/);
});

test("transport failures are not automatically retried and invalid responses are not exposed", async () => {
  const options = parseReviewOptions([
    "publish",
    "--event",
    eventId,
    "--source",
    sourceId,
    "--token",
    token,
    "--approve",
  ]);
  let writes = 0;
  await assert.rejects(
    executeReview(options, async (args, input) => {
      if (args[0] === "context") return "unix:///local/docker.sock";
      writes++;
      assert.match(input, /^begin ;/);
      throw new Error("synthetic transport failure");
    }),
  );
  assert.equal(writes, 1);
  await assert.rejects(
    executeReview(options, async (args) =>
      args[0] === "context"
        ? "unix:///local/docker.sock"
        : "PRIVATE INVALID DATABASE RESPONSE",
    ),
    (error) => {
      assert.doesNotMatch(error.message, /PRIVATE INVALID/);
      return true;
    },
  );
});
