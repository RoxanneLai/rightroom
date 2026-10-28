import assert from "node:assert/strict";
import test from "node:test";
import { sourceIdentity, selectSources } from "../../lib/ingestion/sources.ts";
import { normalizeCandidate } from "../../lib/ingestion/normalize.ts";
import {
  validateSearchOptions,
  validateLiveSearchWindow,
  defaultSearchOptions,
} from "../../lib/ingestion/options.ts";
import { parseIngestionArgs } from "../../lib/ingestion/cli.ts";
import { readIngestionConfig } from "../../lib/ingestion/config.ts";
import {
  candidate,
  fact,
  rejectedCandidate,
  report,
  url,
  options,
} from "./helpers.mjs";

const normalize = (
  input,
  window = options,
  observedAt = "2026-09-01T12:00:00Z",
) => normalizeCandidate(input, sourceIdentity(url), report, window, observedAt);

test("the observed in_person alias is normalized only after quote grounding without mutating its evidence", () => {
  const c = candidate();
  c.event_format.value = "in_person";
  const before = structuredClone(c);
  const normalized = normalize(c);
  assert.equal(normalized.event_format, "in-person");
  assert.deepEqual(normalized.normalization_notes, [
    "event_format_normalized_in_person",
  ]);
  assert.deepEqual(c, before);
  assert.deepEqual(
    { ...normalized, normalization_notes: undefined },
    { ...normalize(candidate()), normalization_notes: undefined },
  );
  c.time_zone = fact(null);
  assert.deepEqual(normalize(c).normalization_notes, [
    "timezone_inferred_nyc",
    "event_format_normalized_in_person",
  ]);
});

test("format spelling normalization does not guess unknown labels or turn virtual events into physical ones", () => {
  for (const value of [
    "virtual",
    "online",
    "offline",
    "physical",
    "In Person",
    "In_Person",
    "inperson",
    "hy_brid",
    "in_person online",
  ]) {
    const c = candidate();
    c.event_format.value = value;
    assert.throws(() => normalize(c), { code: "unsupported_event_format" });
  }
  for (const value of ["in-person", "hybrid"]) {
    const c = candidate();
    c.event_format.value = value;
    assert.equal(normalize(c).event_format, value);
    assert.equal(normalize(c).normalization_notes, undefined);
  }
});

test("format aliases cannot bypass absent quotes, rejection verdicts, eligibility or freshness gates", () => {
  const c = candidate();
  c.event_format.value = "in_person";
  for (const quote of [null, "", "A phrase not present in the source"]) {
    c.event_format.quote = quote;
    assert.throws(() => normalize(c), { code: "incomplete_event" });
  }
  c.event_format.quote = report;
  c.city = fact("Boston");
  assert.throws(() => normalize(c), { code: "outside_search_location" });
  c.city = fact("New York");
  assert.throws(
    () => normalize(c, { ...options, from: "2026-09-07T00:00:00Z" }),
    { code: "outside_search_window" },
  );
  assert.throws(() => normalize(c, options, "2026-09-05T22:01:00Z"), {
    code: "event_already_started",
  });
  c.source_verification = {
    status: "rejected",
    reason: "source_page_virtual_only",
  };
  assert.throws(() => normalize(c), { code: "invalid_candidate" });
});

test("one JSON escape layer on the exact attendance-mode fragment is grounded without mutating model evidence", () => {
  for (const [value, mode, expected] of [
    ["in-person", "OfflineEventAttendanceMode", "in-person"],
    ["in_person", "OfflineEventAttendanceMode", "in-person"],
    ["hybrid", "MixedEventAttendanceMode", "hybrid"],
  ]) {
    const quote = `eventAttendanceMode":"https://schema.org/${mode}`;
    const c = candidate();
    c.event_format = fact(value, JSON.stringify(quote).slice(1, -1));
    const original = structuredClone(c);
    const event = normalizeCandidate(
      c,
      sourceIdentity(url),
      report + "\n" + quote + '"',
      options,
      "2026-09-01T12:00:00Z",
    );
    assert.equal(event.event_format, expected);
    assert.ok(
      event.normalization_notes.includes(
        "event_format_quote_json_escape_normalized",
      ),
    );
    assert.deepEqual(c, original);
    c.event_format.quote = quote;
    const exact = normalizeCandidate(
      c,
      sourceIdentity(url),
      report + "\n" + quote + '"',
      options,
      "2026-09-01T12:00:00Z",
    );
    assert.ok(
      !exact.normalization_notes?.includes(
        "event_format_quote_json_escape_normalized",
      ),
    );
  }
});

test("attendance-mode quote compatibility rejects other escapes, extra layers, mismatched modes and absent evidence", () => {
  const exact =
    'eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode';
  const escaped = JSON.stringify(exact).slice(1, -1);
  const evidence = report + "\n" + exact + '"';
  for (const quote of [
    JSON.stringify(escaped).slice(1, -1),
    escaped.replace("https://", "https:\\/\\/"),
    escaped.replace("eventAttendanceMode", "\\u0065ventAttendanceMode"),
    escaped + " extra",
    'eventAttendanceMode\\": "https://schema.org/OfflineEventAttendanceMode',
    JSON.stringify(
      'eventAttendanceMode":"https://schema.org/OnlineEventAttendanceMode',
    ).slice(1, -1),
    JSON.stringify("in-person event").slice(1, -1),
    "x".repeat(4001),
    null,
  ]) {
    const c = candidate();
    c.event_format = fact("in-person", quote);
    assert.throws(
      () =>
        normalizeCandidate(
          c,
          sourceIdentity(url),
          evidence,
          options,
          "2026-09-01T12:00:00Z",
        ),
      { code: "incomplete_event" },
    );
  }
  const c = candidate();
  c.event_format = fact("in-person", escaped);
  assert.throws(() => normalize(c), { code: "incomplete_event" });
  for (const suffix of ["", 'InventedMode"']) {
    assert.throws(
      () =>
        normalizeCandidate(
          c,
          sourceIdentity(url),
          report + "\n" + exact + suffix,
          options,
          "2026-09-01T12:00:00Z",
        ),
      { code: "incomplete_event" },
    );
  }
  c.title = fact("Founder Test", JSON.stringify('"Founder Test"').slice(1, -1));
  assert.throws(
    () =>
      normalizeCandidate(
        c,
        sourceIdentity(url),
        evidence + '\n"Founder Test"',
        options,
        "2026-09-01T12:00:00Z",
      ),
    { code: "incomplete_event" },
  );
});

test("escaped attendance-mode quotes never bypass virtual, location, date, rejection or relevance gates", () => {
  const exact =
    'eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode';
  const evidence = report + "\n" + exact + '"';
  const c = candidate();
  c.event_format = fact("in-person", JSON.stringify(exact).slice(1, -1));
  const check = (
    input = c,
    window = options,
    observedAt = "2026-09-01T12:00:00Z",
  ) =>
    normalizeCandidate(
      input,
      sourceIdentity(url),
      evidence,
      window,
      observedAt,
    );
  const virtual = candidate();
  const online =
    'eventAttendanceMode":"https://schema.org/OnlineEventAttendanceMode';
  virtual.event_format = fact("virtual", JSON.stringify(online).slice(1, -1));
  assert.throws(
    () =>
      normalizeCandidate(
        virtual,
        sourceIdentity(url),
        report + "\n" + online + '"',
        options,
        "2026-09-01T12:00:00Z",
      ),
    { code: "unsupported_event_format" },
  );
  assert.throws(() => check({ ...c, city: fact("Boston") }), {
    code: "outside_search_location",
  });
  assert.throws(() => check(c, { ...options, from: "2026-09-07T00:00:00Z" }), {
    code: "outside_search_window",
  });
  assert.throws(() => check(c, options, "2026-09-05T22:01:00Z"), {
    code: "event_already_started",
  });
  assert.throws(
    () =>
      check({ ...c, relevant_to_founders: fact(true, "Unstated relevance") }),
    { code: "irrelevant_event" },
  );
  assert.throws(
    () =>
      check({
        ...c,
        source_verification: { status: "rejected", reason: "source_page_past" },
      }),
    { code: "invalid_candidate" },
  );
  assert.throws(() => check(rejectedCandidate(url, "source_page_past")), {
    code: "source_page_past",
  });
});

test("canonicalizes listing URLs without merging meaningful query parameters", () => {
  assert.equal(
    sourceIdentity("https://www.lu.ma/founder-test/?utm_source=x#details")
      .source_url,
    url,
  );
  assert.equal(
    sourceIdentity("https://luma.com/founder-test?event=2").source_url,
    url + "?event=2",
  );
  assert.equal(
    sourceIdentity("https://www.meetup.com/group/events/123/").external_id,
    "123",
  );
  assert.equal(
    sourceIdentity("https://eventbrite.com/e/founders-tickets-123").external_id,
    "123",
  );
  assert.deepEqual(
    sourceIdentity(
      "https://www.productcircle.co/events/new-york-november-2026/?utm_source=test#details",
    ),
    {
      source_name: "productcircle.co",
      source_url: "https://productcircle.co/events/new-york-november-2026",
      external_id: "new-york-november-2026",
    },
  );
});

test("rejects arbitrary hosts, credentials, non-HTTPS URLs and non-listing pages", () => {
  for (const input of [
    "http://luma.com/foo",
    "https://127.0.0.1/foo",
    "https://localhost/foo",
    "https://luma.com.evil.test/foo",
    "https://evil.luma.com/foo",
    "https://me:lame@luma.com/foo",
    "file:///etc/passwd",
    "https://luma.com:123/foo",
    "https://luma.com/discover",
    "https://luma.com/",
    "https://meetup.com/find",
    "https://eventbrite.com/d/ny--new-york/events/",
    "https://productcircle.co/events",
    "https://productcircle.co/events/nyc",
    "https://productcircle.co/events/new-york-2026",
    "https://productcircle.co/events/new-york-summer-2026",
    "https://productcircle.co/events/New-York-November-2026",
    "https://productcircle.co/events/new-york-november-26",
    "https://productcircle.co/events/new-york-november-2026/extra",
    "https://events.productcircle.co/events/new-york-november-2026",
  ])
    assert.equal(sourceIdentity(input), null, input);
});

test("deduplicates source aliases, external IDs and tracking URLs before applying the limit", () => {
  assert.equal(
    selectSources(
      [
        url,
        url + "?utm_source=x",
        "https://lu.ma/founder-test",
        "https://luma.com/second",
      ],
      1,
    ).length,
    1,
  );
  assert.equal(
    selectSources(
      ["https://meetup.com/a/events/12", "https://meetup.com/b/events/12"],
      10,
    ).length,
    1,
  );
  assert.deepEqual(
    selectSources([url + "?utm_source=search", "https://luma.com/second"], 3, [
      "https://lu.ma/founder-test",
    ]).map((source) => source.source_url),
    ["https://luma.com/second"],
  );
  assert.deepEqual(
    selectSources(
      ["https://meetup.com/new/events/12", "https://meetup.com/new/events/13"],
      3,
      ["https://meetup.com/old/events/12"],
    ).map((source) => source.external_id),
    ["13"],
  );
  assert.equal(
    selectSources(
      [
        "https://www.productcircle.co/events/new-york-november-2026?utm_source=first",
        "https://productcircle.co/events/new-york-november-2026",
      ],
      10,
    ).length,
    1,
  );
});

test("normalizes a supported event without adding scores or publication privileges", () => {
  const result = normalize(candidate());
  assert.equal(result.starts_at, "2026-09-05T22:00:00.000Z");
  assert.equal(result.price_amount_cents, 1250);
  assert.equal(result.currency_code, "USD");
  assert.equal(result.venue_name, null);
  assert.equal("publication_status" in result, false);
  assert.equal("founder_score" in result, false);
});

test("source-page rejection verdicts stay unlinked and cannot carry facts", () => {
  for (const reason of [
    "source_fetch_failed",
    "source_not_event_listing",
    "source_page_conflict",
    "source_page_past",
    "source_page_cancelled",
    "source_page_virtual_only",
    "source_evidence_insufficient",
  ]) {
    assert.throws(() => normalize(rejectedCandidate(url, reason)), {
      code: reason,
    });
  }
  const mixed = rejectedCandidate();
  mixed.title = fact("Invented Event");
  assert.throws(() => normalize(mixed), /invalid_candidate/);
  const inconsistent = candidate();
  inconsistent.source_verification.reason = "source_page_conflict";
  assert.throws(() => normalize(inconsistent), /invalid_candidate/);
  for (const relevance of [fact(false), fact(null), fact(true, null)]) {
    assert.throws(
      () => normalize({ ...candidate(), relevant_to_founders: relevance }),
      /invalid_candidate/,
    );
  }
});

test("unknown or unsupported optional fields stay unknown; missing core fields stay unlinked", () => {
  const c = candidate();
  c.organizer_name = fact("Invented Organizer", "this is not in the report");
  c.price_amount_cents = fact(null);
  c.registration_status = fact("made-up");
  const result = normalize(c);
  assert.equal(result.organizer_name, null);
  assert.equal(result.price_amount_cents, null);
  assert.equal(result.currency_code, null);
  assert.equal(result.registration_status, "unknown");
  c.starts_at = fact(null);
  assert.throws(() => normalize(c), /incomplete_event/);
});

test("free requires an explicit supported zero and currency", () => {
  const c = candidate();
  c.price_amount_cents = fact(0);
  assert.equal(normalize(c).price_amount_cents, 0);
  c.currency_code = fact(null);
  assert.equal(normalize(c).price_amount_cents, null);
  c.currency_code = fact("USD", "Tickets are 12.50");
  assert.equal(normalize(c).currency_code, null);
});

test("accepts ISO timestamps with omitted seconds and checks winter offsets", () => {
  assert.equal(
    normalize({ ...candidate(), starts_at: fact("2026-09-05T18:00-04:00") })
      .starts_at,
    "2026-09-05T22:00:00.000Z",
  );
  const winter = {
    ...options,
    from: "2026-12-01T00:00:00Z",
    to: "2026-12-15T00:00:00Z",
  };
  const c = {
    ...candidate(),
    starts_at: fact("2026-12-05T18:00:00-05:00"),
    ends_at: fact(null),
  };
  assert.equal(normalize(c, winter).starts_at, "2026-12-05T23:00:00.000Z");
  c.starts_at = fact("2026-12-05T18:00:00-04:00");
  assert.throws(() => normalize(c, winter), /invalid_event_timezone/);
});

test("rejects invented titles, invalid dates, DST mismatch, and backwards duration", () => {
  assert.throws(
    () => normalize({ ...candidate(), title: fact("Invented Event") }),
    /unsupported_title/,
  );
  assert.throws(
    () =>
      normalize({
        ...candidate(),
        starts_at: fact("2026-02-30T18:00:00-04:00"),
      }),
    /incomplete_event/,
  );
  assert.throws(
    () =>
      normalize({
        ...candidate(),
        starts_at: fact("2026-09-05T18:00:00-05:00"),
      }),
    /invalid_event_timezone/,
  );
  assert.throws(
    () =>
      normalize({ ...candidate(), ends_at: fact("2026-09-05T17:00:00-04:00") }),
    /invalid_event_end/,
  );
  assert.throws(
    () => normalize({ ...candidate(), starts_at: fact("2026-09-05") }),
    /incomplete_event/,
  );
});

test("rejects non-NYC, virtual, irrelevant, out-of-range and mismatched-source listings", () => {
  assert.throws(
    () => normalize({ ...candidate(), city: fact("Boston") }),
    /outside_search_location/,
  );
  assert.throws(
    () => normalize({ ...candidate(), event_format: fact("virtual") }),
    /unsupported_event_format/,
  );
  assert.throws(
    () =>
      normalize({
        ...candidate(),
        relevant_to_founders: fact(true, "unsupported relevance evidence"),
      }),
    /irrelevant_event/,
  );
  assert.throws(
    () =>
      normalize({
        ...candidate(),
        starts_at: fact("2026-09-15T00:00:00Z"),
        ends_at: fact(null),
      }),
    /outside_search_window/,
  );
  assert.throws(
    () => normalize({ ...candidate(), source_url: "https://luma.com/other" }),
    /source_mismatch/,
  );
  assert.throws(
    () => normalize(candidate(), options, "2026-09-05T22:00:00Z"),
    /event_already_started/,
  );
});

test("search windows and candidate limits are bounded", () => {
  assert.deepEqual(validateSearchOptions(options), options);
  assert.equal(
    defaultSearchOptions(new Date("2026-09-01T00:00:00Z")).to,
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(defaultSearchOptions().profile, "career");
  assert.equal(
    defaultSearchOptions(new Date("2026-09-01T00:00:00Z"), "founder").to,
    "2026-09-15T00:00:00.000Z",
  );
  for (const limit of [0, -1, 11, 1.5])
    assert.throws(() => validateSearchOptions({ ...options, limit }));
  assert.throws(() => validateSearchOptions({ ...options, to: options.from }));
  assert.throws(() =>
    validateSearchOptions({ ...options, to: "2026-12-01T00:00:00Z" }),
  );
  assert.deepEqual(
    validateLiveSearchWindow(options, new Date("2026-09-01T00:15:00.000Z")),
    options,
  );
  assert.throws(
    () =>
      validateLiveSearchWindow(options, new Date("2026-09-01T00:15:00.001Z")),
    /stale_live_window/,
  );
  assert.throws(
    () => validateLiveSearchWindow(options, new Date("2026-09-15T00:00:00Z")),
    /stale_live_window/,
  );
});

test("CLI defaults to a no-network plan and fails closed on malformed arguments", () => {
  assert.equal(parseIngestionArgs([]).live, false);
  assert.equal(parseIngestionArgs(["--live"]).live, true);
  assert.equal(parseIngestionArgs(["--help"]).help, true);
  for (const args of [
    ["--limit", "11"],
    ["--limit", "1e1"],
    ["--form", "x"],
    ["--from", options.from],
  ]) {
    assert.throws(() => parseIngestionArgs(args));
  }
});

test("live database configuration requires paid opt-in and local-only credentials", () => {
  const sqlite = readIngestionConfig({ FOUNDER_RADAR_ALLOW_PAID_API: "1" });
  assert.equal(sqlite.backend, "sqlite");
  assert.match(sqlite.path, /data\/founder-radar\.sqlite$/);
  const env = {
    FOUNDER_RADAR_ALLOW_PAID_API: "1",
    DATABASE_BACKEND: "supabase",
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "test-only",
  };
  assert.equal(readIngestionConfig(env).supabaseUrl, "http://127.0.0.1:54321");
  assert.throws(() => readIngestionConfig({}), /paid_api_not_enabled/);
  assert.throws(
    () =>
      readIngestionConfig({
        FOUNDER_RADAR_ALLOW_PAID_API: "1",
        DATABASE_BACKEND: "unknown",
      }),
    /invalid_database_configuration/,
  );
  assert.throws(
    () => readIngestionConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: "" }),
    /missing_ingestion_environment/,
  );
  for (const dbUrl of [
    "https://project.supabase.co",
    "http://localhost.evil:54321",
    "http://user:pass@localhost:54321",
    "http://localhost:54321/path",
  ]) {
    assert.throws(
      () => readIngestionConfig({ ...env, SUPABASE_URL: dbUrl }),
      /local_database_required/,
    );
  }
});
