import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { SupabaseIngestionRepository } from "../../lib/ingestion/repository.ts";
import { importSupabaseSnapshot } from "../../lib/storage/supabase-import.ts";
import { candidate, fact, report, url, options } from "./helpers.mjs";
import {
  readCareerTarget,
  careerSearchPlan,
} from "../../lib/career/profile.ts";
import {
  careerCandidateSchema,
  careerAssessmentSchema,
  schemaForProfile,
} from "../../lib/career/contracts.ts";
import { normalizeCandidate } from "../../lib/ingestion/normalize.ts";
import {
  assertQuotedEventYear,
  resolveNycTime,
} from "../../lib/ingestion/event-time.ts";
import { privateCandidateFailure } from "../../lib/ingestion/private-candidate-failure.ts";
import { careerSourceEvidence } from "../../lib/career/evidence.ts";
import {
  validationFailure,
  safeValidationFailures,
} from "../../lib/ingestion/candidate-validation.ts";
import { parseIngestionArgs } from "../../lib/ingestion/cli.ts";
import { sourceIdentity } from "../../lib/ingestion/sources.ts";
import { publicListingUrl } from "../../lib/public-listing-url.ts";
import { SqliteIngestionRepository } from "../../lib/ingestion/sqlite-repository.ts";
import { openSqliteDatabase } from "../../lib/storage/sqlite.ts";
import { runIngestion } from "../../lib/ingestion/run.ts";
import {
  executeSqliteInspection,
  runInspectionCli,
} from "../../lib/ingestion/inspection.ts";
import { executeSqliteReview } from "../../lib/review/repository.ts";
import { buildReviewReport } from "../../lib/review/report.ts";
import { loadDashboard } from "../../lib/dashboard/repository.ts";
import { OpenRouterSearchProvider } from "../../lib/ingestion/openrouter-provider.ts";
import {
  previewRecovery,
  applyRecovery,
  parseLeadArgs,
  readRecoveryEvidence,
  runLeadCli,
} from "../../lib/recovery/leads.ts";

const target = await readCareerTarget();
const now = new Date("2026-09-01T12:00:00.000Z");
const evidence =
  report +
  " Product discovery and prioritization for career entrants. Avery Example, Product Manager at Example Bank, will speak and join networking. Fintech software platforms. Public attendance welcome. Founder Morgan Example of Seed Example startup will speak during a keynote with Q&A. East 39th Street was originally reported.";
const careerOptions = {
  ...options,
  profile: "career",
  searches: 3,
  career_target: target,
};
function careerCandidate() {
  const c = candidate();
  for (const key of Object.keys(c))
    if (!["source_url", "source_verification"].includes(key))
      c[key] = fact(c[key].value, evidence);
  c.relevant_to_founders = fact(null);
  c.time_zone = fact(null);
  c.venue_name = fact("Example workspace", "Example workspace in New York");
  c.venue_name = fact(null);
  c.price_amount_cents = fact(null);
  c.currency_code = fact(null);
  c.career = {
    kind: fact("product", evidence),
    product_relevance: fact("direct", evidence),
    delivery_relevance: fact(null),
    domain: fact("fintech", evidence),
    eligibility: fact("open", evidence),
    restrictions: [],
    prerequisites: [],
    people: [
      {
        name: fact("Avery Example", evidence),
        company: fact("Example Bank", evidence),
        role: fact("Product Manager", evidence),
        participation: fact("speaker", evidence),
      },
    ],
    interaction: fact("networking", evidence),
    hiring: fact(null),
    startup_context: fact("other", evidence),
    founders: [],
  };
  return c;
}
function normalize(
  c = careerCandidate(),
  opts = careerOptions,
  text = evidence,
) {
  return normalizeCandidate(
    c,
    sourceIdentity(url),
    text,
    opts,
    now.toISOString(),
  );
}
async function temporary() {
  await mkdir("codex-tmp", { recursive: true });
  const dir = await mkdtemp("codex-tmp/career-test-");
  return { dir, path: join(dir, "test.sqlite") };
}
function repository(path) {
  return new SqliteIngestionRepository(
    path,
    "vendor/offline",
    "medium",
    "vendor/offline",
    "low",
  );
}

test("CLI defaults to career while explicit founder and historical options retain their behavior", () => {
  assert.equal(target.weights.role_fit, 30);
  const defaults = parseIngestionArgs([], now).options;
  assert.equal(defaults.profile, "career");
  assert.equal(defaults.searches ?? 3, 3);
  assert.equal(defaults.limit, 10);
  assert.deepEqual(
    defaults,
    parseIngestionArgs(["--profile", "career"], now).options,
  );
  assert.equal(
    parseIngestionArgs(["--profile", "founder"], now).options.to,
    "2026-09-15T12:00:00.000Z",
  );
  assert.equal(defaults.to, "2026-10-01T12:00:00.000Z");
  assert.equal(
    parseIngestionArgs(["--career-config", "custom.json"], now)
      .careerConfigPath,
    "custom.json",
  );
  assert.equal(
    parseIngestionArgs(["--searches", "4"], now).options.searches,
    4,
  );
  assert.equal(schemaForProfile(), schemaForProfile("founder"));
  assert.deepEqual(
    parseIngestionArgs(["--from", options.from, "--to", options.to], now)
      .options,
    { ...defaults, from: options.from, to: options.to },
  );
  const parsed = parseIngestionArgs(
    ["--profile", "career", "--searches", "12", "--limit", "3"],
    now,
  );
  assert.equal(parsed.options.to, "2026-10-01T12:00:00.000Z");
  assert.equal(parsed.options.limit, 3);
  assert.deepEqual(
    careerSearchPlan({ ...parsed.options, career_target: target })
      .slice(0, 3)
      .map((query) => query.family),
    ["product", "company_technology", "financial_technology"],
  );
  const plan = careerSearchPlan({ ...parsed.options, career_target: target });
  assert.equal(plan.length, 12);
  assert.equal(plan.filter((query) => query.family === "delivery").length, 2);
  assert.ok(
    plan.every(
      (query) =>
        query.query.includes(parsed.options.from) &&
        query.query.includes(parsed.options.to),
    ),
  );
  for (const args of [
    ["--profile", "bad"],
    ["--profile", ""],
    ["--profile"],
    ["--profile", "career", "--profile", "founder"],
    ["--profile", "career", "--searches", "13"],
    ["--profile", "founder", "--searches", "4"],
    ["--profile", "founder", "--career-config", "custom.json"],
    ["--searches", "0"],
    ["--profile", "career", "--searches", "3", "--searches", "3"],
    ["--profile", "career", "--searches"],
    ["--career-config", ""],
  ])
    assert.throws(() => parseIngestionArgs(args, now));
});

test("career plan is free and fails before key/database/network reads", async () => {
  const { dir } = await temporary();
  await mkdir(join(dir, "config"));
  for (const name of ["career.json", "ingestion.json"])
    await writeFile(
      join(dir, "config", name),
      await readFile("config/" + name),
    );
  await mkdir(join(dir, "OPENROUTER.key"));
  const entry = resolve("scripts/ingest.ts");
  const run = (args) =>
    spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); }; process.argv=['node','ingest',...${JSON.stringify(args)}]; await import(${JSON.stringify(entry)});`,
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          DATABASE_BACKEND: "invalid-no-database-access",
        },
        timeout: 10000,
      },
    );
  const result = run(["--limit", "3"]);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.profile, "career");
  assert.equal(
    Date.parse(plan.options.to) - Date.parse(plan.options.from),
    30 * 86400000,
  );
  assert.equal(plan.paid_calls, false);
  assert.equal(plan.writes, false);
  assert.equal(plan.executed_queries, null);
  assert.equal(plan.planned_queries.length, 3);
  await writeFile(
    join(dir, "config/career.json"),
    '{"background":"SECRET_UNKNOWN_FIELD"}',
  );
  const malformed = run(["--profile", "career", "--live"]);
  assert.match(malformed.stderr, /invalid_career_config/);
  assert.doesNotMatch(malformed.stderr, /SECRET|NETWORK|key/);
});

test("career events qualify without founders/jobs and keep legacy schema separate", () => {
  const c = careerCandidate();
  assert.equal(careerCandidateSchema.safeParse(c).success, true);
  assert.equal(schemaForProfile("founder").safeParse(c).success, false);
  const draft = normalize(c);
  assert.equal(draft.career_assessment.score, 95);
  assert.equal(draft.career_assessment.version, "career-score-v3");
  assert.equal(draft.career_assessment.founderAccess, "not_applicable");
  assert.equal(draft.career_assessment.hiring, null);
  assert.ok(draft.career_assessment.cautions.includes("timezone_inferred_nyc"));
  assert.equal(draft.price_amount_cents, null);
  assert.equal(c.time_zone.value, null);
});

test("compound preferred domains earn one supported bonus without changing model facts or other components", () => {
  const quote =
    "An evening on open source, observability, and production software.";
  const text = evidence + " " + quote;
  const c = careerCandidate();
  c.career.domain = fact("developer tools and observability", quote);
  const original = structuredClone(c);
  const baseline = structuredClone(c);
  baseline.career.domain = fact(null);
  const before = normalize(baseline, careerOptions, text).career_assessment;
  const after = normalize(c, careerOptions, text).career_assessment;
  assert.equal(after.components.domain, 15);
  assert.equal(after.score, before.score + 15);
  assert.ok(after.reasons.includes("preferred_domain"));
  for (const field of ["role_fit", "people", "interaction", "access"])
    assert.equal(after.components[field], before.components[field]);
  assert.deepEqual(c, original);
  assert.equal(after.version, "career-score-v3");
  assert.equal(
    careerAssessmentSchema.safeParse({ ...after, version: "career-score-v1" })
      .success,
    true,
  );
  assert.equal(
    careerAssessmentSchema.safeParse({ ...after, version: "career-score-v4" })
      .success,
    false,
  );
  const restricted = {
    ...careerOptions,
    career_target: { ...target, preferred_domains: ["fintech"] },
  };
  assert.equal(
    normalize(c, restricted, text).career_assessment.components.domain,
    0,
  );
  c.career.domain.quote =
    "Invented observability and production software evidence.";
  assert.throws(
    () => normalize(c, careerOptions, text),
    /unsupported_career_evidence/,
  );
});

test("compound matching is whole-term, quote-scoped, bounded and conservative about missing or negative evidence", () => {
  const quote =
    "Developer tools, fintech and enterprise platforms enable production observability.";
  const text = evidence + " " + quote;
  for (const label of [
    "DEVELOPER TOOLS & OBSERVABILITY",
    "observability / developer tools",
    "developer tools, observability",
    "fintech and enterprise platforms",
    "  developer   tools ; observability  ",
  ]) {
    const c = careerCandidate();
    c.career.domain = fact(label, quote);
    assert.equal(
      normalize(c, careerOptions, text).career_assessment.components.domain,
      15,
      label,
    );
  }
  for (const [label, supporting] of [
    ["developer tools and observability", "Public attendance welcome."],
    [
      "developer tools and observability",
      "Observability of wildlife habitats.",
    ],
    [
      "developer tools and observability",
      "Not about developer tools or production observability.",
    ],
    ["developer tools and wildlife", "Production observability."],
    [
      "developer tools and observability and wildlife",
      "Production observability.",
    ],
    ["nondeveloper tools and observability", "Production observability."],
    ["fintech and infrastructure", "Fintechnology infrastructure."],
    ["developer tools and", quote],
    ["observability", "Production observability."],
    [
      "developer tools and " + Array(8).fill("observability").join(" and "),
      quote,
    ],
  ]) {
    const c = careerCandidate();
    c.career.domain = fact(label, supporting);
    assert.equal(
      normalize(c, careerOptions, text + " " + supporting).career_assessment
        .components.domain,
      0,
      label + ": " + supporting,
    );
  }
  const unknown = careerCandidate();
  unknown.career.domain = fact(null);
  assert.equal(normalize(unknown).career_assessment.components.domain, 0);
  assert.ok(
    normalize(unknown).career_assessment.cautions.includes("domain_unknown"),
  );
});

test("unknown registration stays null/null and becomes a visible caution, not fabricated availability", () => {
  const c = careerCandidate();
  c.registration_status = { value: null, quote: null };
  const draft = normalize(c);
  assert.equal(draft.registration_status, "unknown");
  assert.ok(draft.career_assessment.cautions.includes("registration_unknown"));
  assert.equal(draft.career_assessment.components.access, 2.5);
  for (const pair of [
    { value: "unknown", quote: null },
    { value: "open", quote: null },
    { value: "open", quote: "" },
    { value: null, quote: "Register here" },
  ]) {
    c.registration_status = pair;
    const failure = validationFailure(
      "123e4567-e89b-42d3-a456-426614174000",
      "invalid_candidate",
      c,
      careerCandidateSchema,
    );
    assert.ok(
      failure.fields.some(
        (entry) => entry.path === "registration_status.quote",
      ),
    );
    assert.throws(() => normalize(c), /invalid_candidate/);
  }
});

test("explicit event years cannot be rolled forward; copyright years are not event dates", () => {
  const start = "2026-09-05T22:00:00.000Z";
  for (const quote of [
    "September 5, 2025 at 6 PM EDT. Copyright 2026.",
    "Sep. 5th, 2025 at 6 PM EDT.",
    "5 September 2025 at 6 PM EDT.",
    "2025-09-05T18:00:00-04:00",
  ])
    assert.throws(
      () => assertQuotedEventYear(start, quote),
      /source_page_conflict/,
    );
  assert.doesNotThrow(() =>
    assertQuotedEventYear(
      start,
      "September 5, 2026 at 6 PM EDT. Copyright 2025.",
    ),
  );
  assert.doesNotThrow(() =>
    assertQuotedEventYear(start, "Copyright 2025. Registration opens in 2025."),
  );
  assert.doesNotThrow(() =>
    assertQuotedEventYear("2026-01-01T00:30:00.000Z", "2026-01-01T00:30Z"),
  );
  assert.doesNotThrow(() =>
    assertQuotedEventYear(
      "2026-01-01T00:30:00.000Z",
      "December 31, 2025 at 7:30 PM EST",
    ),
  );
  const c = careerCandidate();
  c.starts_at = fact(
    "2026-09-05T18:00:00-04:00",
    "September 5, 2025 at 6 PM EDT",
  );
  assert.throws(
    () =>
      normalize(c, careerOptions, evidence + " September 5, 2025 at 6 PM EDT"),
    /source_page_conflict/,
  );
  c.starts_at = fact(
    "2025-09-05T18:00:00-04:00",
    "September 5, 2025 at 6 PM EDT",
  );
  assert.throws(
    () =>
      normalize(c, careerOptions, evidence + " September 5, 2025 at 6 PM EDT"),
    /outside_search_window/,
  );
});

test("founder access needs connected actual startup participation and keynotes earn only Q&A credit", () => {
  const c = careerCandidate();
  c.career.startup_context = fact("startup", evidence);
  c.career.founders = [
    {
      name: fact("Morgan Example", evidence),
      company: fact("Seed Example", evidence),
      role: fact("founder", evidence),
      participation: fact("speaker", evidence),
    },
  ];
  c.career.people = [];
  c.career.interaction = fact("qa", evidence);
  let assessment = normalize(c).career_assessment;
  assert.equal(assessment.founderAccess, "applicable");
  assert.equal(assessment.components.interaction, 10);
  c.career.founders[0].name = fact("Invented person", evidence);
  assessment = normalize(c).career_assessment;
  assert.equal(assessment.founderAccess, "unknown");
  assert.equal(assessment.components.people, 0);
  c.career.startup_context = fact("other", evidence);
  assert.equal(normalize(c).career_assessment.founderAccess, "not_applicable");
});

test("sponsors/venues do not earn people access; restrictions, paid entry, unknowns and prerequisites stay visible", () => {
  const c = careerCandidate();
  c.career.people[0].participation = fact("sponsor", evidence);
  c.career.eligibility = fact("approval_required", evidence);
  c.career.prerequisites = [fact("Coding prerequisites", evidence)];
  c.price_amount_cents = fact(2000, evidence);
  c.currency_code = fact("USD", evidence);
  const assessment = normalize(c).career_assessment;
  assert.equal(assessment.components.people, 0);
  assert.ok(assessment.cautions.includes("prerequisites"));
  assert.ok(assessment.cautions.includes("approval_required"));
  c.career.eligibility = fact("ineligible", evidence);
  assert.throws(() => normalize(c), /ineligible_event/);
  c.career.eligibility = fact(null);
  c.registration_status = fact("closed", evidence);
  assert.throws(() => normalize(c), /ineligible_event/);
  c.registration_status = fact("waitlist", evidence);
  assert.ok(normalize(c).career_assessment.cautions.includes("waitlist"));
});

test("career quotes must be exact, unknown founder fields remain null and rejection verdicts are fact-free", () => {
  const c = careerCandidate();
  c.career.product_relevance.quote = "invented explanation";
  assert.throws(() => normalize(c), /unsupported_career_evidence/);
  c.career.product_relevance.quote = evidence;
  c.relevant_to_founders = fact(true, evidence);
  assert.throws(() => normalize(c), /invalid_candidate/);
  const rejected = careerCandidate();
  rejected.source_verification = {
    status: "rejected",
    reason: "source_fetch_failed",
  };
  assert.equal(careerCandidateSchema.safeParse(rejected).success, false);
  for (const key of Object.keys(rejected))
    if (!["source_url", "source_verification"].includes(key))
      rejected[key] = key === "career" ? null : fact(null);
  assert.throws(() => normalize(rejected), /source_fetch_failed/);
});

test("timezone defaults use the event date and reject explicit conflicts, DST gaps and overlaps", () => {
  assert.equal(resolveNycTime("2026-07-10T18:00"), "2026-07-10T22:00:00.000Z");
  assert.equal(resolveNycTime("2026-01-10T18:00"), "2026-01-10T23:00:00.000Z");
  assert.equal(resolveNycTime("2026-01-10T23:00Z"), "2026-01-10T23:00:00.000Z");
  for (const time of ["2026-03-08T02:30", "2026-11-01T01:30"])
    assert.throws(() => resolveNycTime(time), /ambiguous_event_time/);
  assert.throws(
    () => resolveNycTime("2026-01-10T18:00-04:00"),
    /invalid_event_timezone/,
  );
  const c = candidate();
  c.time_zone = fact(null);
  c.starts_at = fact("2026-09-05T18:00");
  assert.deepEqual(
    normalizeCandidate(
      c,
      sourceIdentity(url),
      report,
      options,
      now.toISOString(),
    ).normalization_notes,
    ["timezone_inferred_nyc"],
  );
  c.city = fact(null);
  assert.throws(
    () =>
      normalizeCandidate(
        c,
        sourceIdentity(url),
        report,
        options,
        now.toISOString(),
      ),
    /incomplete_event/,
  );
});

test("diagnostics retain canonical paths/fixed codes, cap entries and reject reflected private names", () => {
  const c = candidate();
  c.source_verification.reason = "SECRET_REJECTED_VALUE";
  c.title = { value: 17, quote: null };
  c.SECRET_UNKNOWN_NAME = "credential";
  const failure = validationFailure(
    "123e4567-e89b-42d3-a456-426614174000",
    "invalid_candidate",
    c,
    schemaForProfile(),
  );
  assert.ok(
    failure.fields.some((field) => field.path === "source_verification.reason"),
  );
  assert.doesNotMatch(JSON.stringify(failure), /SECRET|credential|message/);
  assert.deepEqual(safeValidationFailures([failure]), [failure]);
  const many = careerCandidate();
  many.career.people = Array.from({ length: 10 }, () => ({
    name: { value: 17, quote: 18 },
    company: { value: 17, quote: 18 },
    role: { value: 17, quote: 18 },
    participation: { value: 17, quote: 18 },
  }));
  const bounded = validationFailure(
    failure.source_id,
    "invalid_candidate",
    many,
    careerCandidateSchema,
  );
  assert.equal(bounded.fields.length, 32);
  assert.equal(bounded.truncated, true);
  assert.doesNotMatch(JSON.stringify(bounded), /SECRET|credential|message/);
  assert.deepEqual(
    safeValidationFailures([
      { ...failure, fields: [{ path: "SECRET_FIELD", reason: "custom" }] },
    ]),
    [],
  );
});

test("verified organizer URL registry strips private parameters and preserves PMI event identity", async () => {
  const input =
    "https://www.pminyc.org/calendar?token=secret&eventId=45084&utm_source=test";
  assert.equal(
    sourceIdentity(input).source_url,
    "https://pminyc.org/calendar?eventId=45084",
  );
  assert.equal(
    publicListingUrl(input),
    "https://pminyc.org/calendar?eventId=45084",
  );
  assert.equal(
    publicListingUrl("https://pminyc.org/calendar?eventId=45084&x=eventId=999"),
    "https://pminyc.org/calendar?eventId=45084",
  );
  assert.equal(
    publicListingUrl("https://pminyc.org/calendar?eventId=%34"),
    null,
  );
  assert.equal(
    publicListingUrl("https://pminyc.org/calendar?%65ventId=4"),
    null,
  );
  assert.equal(
    publicListingUrl("https://pminyc.org/other/../calendar?eventId=4"),
    null,
  );
  assert.notEqual(
    publicListingUrl(input),
    publicListingUrl("https://pminyc.org/calendar?eventId=45085"),
  );
  for (const invalid of [
    "https://pminyc.org/calendar",
    "https://pminyc.org/calendar?eventId=1&eventId=2",
    "https://finos.org/news-and-events",
    "https://events.datadoghq.com/events",
    "https://evil.example/events/item",
  ])
    assert.equal(sourceIdentity(invalid), null);
  assert.equal(
    publicListingUrl(
      "https://finos.org/hosted-events/synthetic-listing?token=private",
    ),
    "https://finos.org/hosted-events/synthetic-listing",
  );
});

test("offline provider sends complete career schema in prompts and bounded searches", async () => {
  const bodies = [];
  const raw = careerCandidate();
  const responses = [
    {
      id: "gen-synthetic-research",
      model: "vendor/test",
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: `### 1. Founder Test\n${evidence}`,
            annotations: [{ type: "url_citation", url_citation: { url } }],
          },
        },
      ],
      usage: { server_tool_use: { web_search_requests: 3 } },
    },
    {
      id: "gen-synthetic-extraction",
      model: "vendor/test",
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({ candidates: [raw] }),
          },
        },
      ],
      usage: {
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 1 },
      },
    },
  ];
  const provider = new OpenRouterSearchProvider(
    "synthetic-key",
    "vendor/test",
    "medium",
    async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    },
  );
  const research = await provider.research(
    careerOptions,
    new AbortController().signal,
  );
  const extracted = await provider.extract(
    research,
    [sourceIdentity(url)],
    careerOptions,
    new AbortController().signal,
  );
  assert.equal(extracted.candidates.length, 1);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].tools[0].parameters.max_uses, 3);
  assert.match(
    bodies[1].messages[0].content,
    /Required schema:.*product_relevance/,
  );
  assert.match(bodies[1].messages[0].content, /null\/null/);
  assert.match(
    bodies[0].messages[0].content,
    /year explicitly stated for the event date/,
  );
  assert.match(
    bodies[1].messages[0].content,
    /source_page_past.*source_page_conflict/,
  );
  assert.match(
    bodies[1].messages[0].content,
    /Unknown registration_status must be \{"value":null,"quote":null\}/,
  );
  assert.match(JSON.stringify(bodies[1].response_format), /product_relevance/);
});

test("private failure snapshots keep exact canonical facts/types but omit unknown transport/trace keys and bound content", () => {
  const c = careerCandidate();
  c.registration_status = { value: "unknown", quote: null };
  c.headers = { Authorization: "SECRET_HEADER" };
  c.reasoning = "SECRET_TRACE";
  c.raw_provider_error = "SECRET_ERROR";
  c.registration_status.reasoning = "SECRET_NESTED_TRACE";
  const failure = privateCandidateFailure(
    "123e4567-e89b-42d3-a456-426614174000",
    "invalid_candidate",
    now.toISOString(),
    [c],
  );
  assert.equal(failure.candidate_count, 1);
  assert.equal(failure.truncated, false);
  assert.deepEqual(
    failure.fields.find((field) => field.path === "registration_status.value"),
    {
      path: "registration_status.value",
      type: "string",
      value: "unknown",
      truncated: false,
    },
  );
  assert.deepEqual(
    failure.fields.find((field) => field.path === "registration_status.quote"),
    { path: "registration_status.quote", type: "null", value: null },
  );
  delete c.registration_status.quote;
  const missing = privateCandidateFailure(
    failure.source_id,
    failure.error_code,
    now.toISOString(),
    [c],
  );
  assert.deepEqual(
    missing.fields.find((field) => field.path === "registration_status.quote"),
    { path: "registration_status.quote", type: "missing" },
  );
  c.title.value = { api_key: "SECRET_NESTED_OBJECT" };
  const wrongType = privateCandidateFailure(
    failure.source_id,
    failure.error_code,
    now.toISOString(),
    [c],
  );
  assert.deepEqual(
    wrongType.fields.find((field) => field.path === "title.value"),
    { path: "title.value", type: "object" },
  );
  for (const snapshot of [failure, missing, wrongType])
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /SECRET|Authorization|raw_provider_error|reasoning/,
    );
  c.title.quote = "x".repeat(20000);
  c.career.people = Array.from({ length: 50 }, () => ({
    name: fact("x".repeat(20000)),
    company: fact("x".repeat(20000)),
    role: fact("x".repeat(20000)),
    participation: fact("speaker"),
  }));
  const bounded = privateCandidateFailure(
    failure.source_id,
    failure.error_code,
    now.toISOString(),
    [c],
  );
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.fields.length <= 256);
  assert.ok(
    bounded.fields.every(
      (field) => typeof field.value !== "string" || field.value.length <= 4000,
    ),
  );
  assert.ok(
    bounded.fields.reduce(
      (sum, field) =>
        sum + (typeof field.value === "string" ? field.value.length : 0),
      0,
    ) <= 12000,
  );
  for (const inputs of [[], [c, c]]) {
    const ambiguous = privateCandidateFailure(
      failure.source_id,
      failure.error_code,
      now.toISOString(),
      inputs,
    );
    assert.equal(ambiguous.candidate_count, inputs.length);
    assert.deepEqual(ambiguous.fields, []);
  }
});

test("SQLite career ingestion, safe inspector and stale publication review share one database", async () => {
  const { path } = await temporary();
  const repo = repository(path);
  const provider = {
    async research() {
      return { report: evidence, urls: [url], metadata: {} };
    },
    async extract() {
      return { candidates: [careerCandidate()], metadata: {} };
    },
  };
  const summary = await runIngestion(careerOptions, {
    repository: repo,
    provider,
    now: () => now,
    signal: new AbortController().signal,
  });
  assert.equal(summary.events_written, 1);
  const inspection = executeSqliteInspection(summary.run_id, path);
  assert.equal(inspection.run.search_parameters.profile, "career");
  const source = inspection.sources[0];
  let feed = await loadDashboard({
    career: true,
    env: { SQLITE_DATABASE_PATH: path },
    now,
  });
  assert.equal(feed.status, "empty");
  const review = executeSqliteReview(
    { command: "preview", eventId: source.event_id, sourceId: source.id },
    path,
  );
  const preview = buildReviewReport(review, now);
  assert.ok(preview.warnings.some((warning) => warning.includes("Timezone")));
  assert.equal(preview.publicPreview.card.careerAssessment.score, 95);
  assert.equal(
    preview.publicPreview.card.careerAssessment.version,
    "career-score-v3",
  );
  const db = openSqliteDatabase(path);
  // Seed a historical assessment in this isolated fixture; reads must not rescore it.
  const historical = {
    ...review.event.career_assessment,
    version: "career-score-v1",
  };
  db.prepare("update events set career_assessment = ? where id = ?").run(
    JSON.stringify(historical),
    source.event_id,
  );
  db.prepare("update events set updated_at = ? where id = ?").run(
    "2026-09-01T13:00:00.000Z",
    source.event_id,
  );
  db.close();
  assert.throws(
    () =>
      executeSqliteReview(
        {
          command: "publish",
          eventId: source.event_id,
          sourceId: source.id,
          token: review.review_token,
          approved: true,
        },
        path,
      ),
    /changed|stale/i,
  );
  const fresh = executeSqliteReview(
    { command: "preview", eventId: source.event_id, sourceId: source.id },
    path,
  );
  executeSqliteReview(
    {
      command: "publish",
      eventId: source.event_id,
      sourceId: source.id,
      token: fresh.review_token,
      approved: true,
      asOf: now.toISOString(),
    },
    path,
    now,
  );
  feed = await loadDashboard({
    career: true,
    env: { SQLITE_DATABASE_PATH: path },
    now,
  });
  assert.equal(feed.events.length, 1);
  assert.deepEqual(feed.events[0].careerAssessment, historical);
  assert.doesNotMatch(
    JSON.stringify(feed),
    /Product discovery and prioritization|raw_payload|research_report/,
  );
  const rerun = await runIngestion(careerOptions, {
    repository: repo,
    provider,
    now: () => now,
    signal: new AbortController().signal,
  });
  assert.equal(rerun.events_written, 0);
  const protectedFeed = await loadDashboard({
    career: true,
    env: { SQLITE_DATABASE_PATH: path },
    now,
  });
  assert.deepEqual(protectedFeed.events[0].careerAssessment, historical);
});

test("SQLite stores calibrated assessments and unchanged private facts with review warnings", async () => {
  const { path } = await temporary();
  const c = careerCandidate();
  const roleQuote = "Agentic AI and AWS cloud workshop.";
  const chatQuote = "Chat with attendees in the group chat for networking.";
  const text = `${evidence} ${roleQuote} ${chatQuote}`;
  c.career.product_relevance = fact("direct", roleQuote);
  c.career.interaction = fact("networking", chatQuote);
  const original = structuredClone(c);
  const summary = await runIngestion(careerOptions, {
    repository: repository(path),
    provider: {
      async research() {
        return { report: text, urls: [url], metadata: {} };
      },
      async extract() {
        return { candidates: [c], metadata: {} };
      },
    },
    now: () => now,
    signal: new AbortController().signal,
  });
  assert.equal(summary.events_written, 1);
  assert.deepEqual(c, original);
  const inspection = executeSqliteInspection(summary.run_id, path);
  const source = inspection.sources[0];
  const snapshot = executeSqliteReview(
    { command: "preview", eventId: source.event_id, sourceId: source.id },
    path,
  );
  assert.equal(snapshot.event.career_assessment.version, "career-score-v3");
  assert.equal(snapshot.event.career_assessment.score, 67.5);
  assert.deepEqual(
    snapshot.sources[0].raw_payload.candidate.career,
    original.career,
  );
  const preview = buildReviewReport(snapshot, now);
  assert.deepEqual(preview.blockers, []);
  assert.match(preview.warnings.join(" "), /Role relevance needs checking/);
  assert.match(preview.warnings.join(" "), /no interaction credit/);
  assert.doesNotMatch(
    JSON.stringify(preview.publicPreview),
    /Agentic AI|group chat/,
  );
  assert.equal(
    (
      await loadDashboard({
        career: true,
        env: { SQLITE_DATABASE_PATH: path },
        now,
      })
    ).status,
    "empty",
  );
});

test("normalization failures persist bounded diagnostics and keep good evidence", async () => {
  const { path } = await temporary();
  const repo = repository(path);
  const c = careerCandidate();
  c.career.product_relevance.value = "PRIVATE_INVALID";
  const summary = await runIngestion(careerOptions, {
    repository: repo,
    provider: {
      async research() {
        return { report: evidence, urls: [url], metadata: {} };
      },
      async extract() {
        return { candidates: [c], metadata: {} };
      },
    },
    now: () => now,
    signal: new AbortController().signal,
  });
  assert.equal(summary.errors[0], "invalid_candidate");
  const safe = await runInspectionCli(["--run", summary.run_id], async () =>
    executeSqliteInspection(summary.run_id, path),
  );
  assert.equal(
    safe.candidate_validation_failures[0].source_id,
    safe.sources[0].id,
  );
  assert.doesNotMatch(JSON.stringify(safe), /PRIVATE_INVALID|research_report/);
  const db = openSqliteDatabase(path);
  const metadata = JSON.parse(
    db
      .prepare("select metadata from search_runs where id = ?")
      .get(summary.run_id).metadata,
  );
  db.close();
  assert.equal(metadata.candidate_failures[0].source_id, safe.sources[0].id);
  assert.equal(
    metadata.candidate_failures[0].fields.find(
      (field) => field.path === "career.product_relevance.value",
    ).value,
    "PRIVATE_INVALID",
  );
  assert.doesNotMatch(
    JSON.stringify(summary),
    /PRIVATE_INVALID|candidate_failures/,
  );
});

test("failed registration refresh preserves good evidence while recording separate private failures for both leads", async () => {
  const { path } = await temporary();
  const repo = repository(path);
  const second = "https://events.datadoghq.com/events/synthetic-past-talk";
  const good = careerCandidate();
  good.registration_status = { value: null, quote: null };
  const provider = {
    async research() {
      return { report: evidence, urls: [url], metadata: {} };
    },
    async extract() {
      return { candidates: [good], metadata: {} };
    },
  };
  const deps = {
    repository: repo,
    provider,
    now: () => now,
    signal: new AbortController().signal,
  };
  const original = await runIngestion(careerOptions, deps);
  assert.equal(original.events_written, 1);
  let db = openSqliteDatabase(path);
  const before = db
    .prepare(
      "select event_id, content_text, content_hash, raw_payload, fetched_at from event_sources where source_url = ?",
    )
    .get(url);
  db.close();
  const broken = structuredClone(good);
  broken.registration_status = { value: "unknown", quote: null };
  const past = structuredClone(good);
  past.source_url = second;
  past.source_verification = { status: "rejected", reason: "source_page_past" };
  for (const key of Object.keys(past))
    if (!["source_url", "source_verification"].includes(key))
      past[key] = key === "career" ? null : { value: null, quote: null };
  const progress = [];
  const summary = await runIngestion(careerOptions, {
    ...deps,
    now: () => new Date("2026-09-01T13:00:00Z"),
    onProgress: async (value) => {
      progress.push(value);
    },
    provider: {
      async research() {
        return {
          report:
            "### 1. Supported room\n" +
            evidence.replace(url + ".", url) +
            "\n### 2. Past room\nOctober 22, 2025, New York. Copyright 2026. " +
            second,
          urls: [url, second],
          metadata: {},
        };
      },
      async extract() {
        return { candidates: [broken, past], metadata: {} };
      },
    },
  });
  assert.equal(summary.status, "partial");
  assert.equal(summary.events_written, 0);
  assert.deepEqual(summary.errors, ["invalid_candidate", "source_page_past"]);
  db = openSqliteDatabase(path);
  const after = db
    .prepare(
      "select event_id, content_text, content_hash, raw_payload, fetched_at from event_sources where source_url = ?",
    )
    .get(url);
  const metadata = JSON.parse(
    db
      .prepare("select metadata from search_runs where id = ?")
      .get(summary.run_id).metadata,
  );
  const pastSource = db
    .prepare(
      "select event_id, raw_payload from event_sources where source_url = ?",
    )
    .get(second);
  db.close();
  assert.deepEqual(after, before);
  assert.equal(pastSource.event_id, null);
  assert.equal(pastSource.raw_payload, "{}");
  assert.equal(metadata.candidate_failures.length, 2);
  assert.equal(metadata.candidate_failures[0].error_code, "invalid_candidate");
  assert.equal(
    metadata.candidate_failures[0].observed_at,
    "2026-09-01T13:00:00.000Z",
  );
  assert.equal(
    metadata.candidate_failures[0].fields.find(
      (field) => field.path === "registration_status.value",
    ).value,
    "unknown",
  );
  assert.equal(metadata.candidate_failures[1].error_code, "source_page_past");
  const safe = await runInspectionCli(["--run", summary.run_id], async () =>
    executeSqliteInspection(summary.run_id, path),
  );
  assert.doesNotMatch(
    JSON.stringify([summary, progress, safe]),
    /candidate_failures|candidate-failure-v1|October 22, 2025/,
  );
  assert.equal(
    (
      await loadDashboard({
        career: true,
        env: { SQLITE_DATABASE_PATH: path },
        now,
      })
    ).status,
    "empty",
  );
});

test("private lead recovery requires history, conflict decisions, fresh evidence and unchanged preview; applies transactionally once", async () => {
  const { dir, path } = await temporary();
  const repo = repository(path);
  const runId = await repo.start(careerOptions);
  await repo.checkpoint(runId, {
    research_report: evidence,
    consulted_urls: [url],
  });
  const saved = await repo.save(
    runId,
    { ...sourceIdentity(url), error_code: "invalid_candidate" },
    null,
    now.toISOString(),
  );
  const freshText = evidence + " Fresh venue: West 30th Street in New York.";
  const c = careerCandidate();
  c.address_line = fact(
    "West 30th Street",
    "Fresh venue: West 30th Street in New York.",
  );
  const supplied = {
    profile: "career",
    source_url: url,
    observed_at: "2026-09-01T13:00:00.000Z",
    evidence_kind: "reviewer_transcription",
    source_text: freshText,
    reviewed_run_ids: [runId],
    resolution_note:
      "Freshly checked listing supersedes the earlier venue report.",
    conflicts: [
      {
        old_quote: "East 39th Street",
        new_quote: "West 30th Street",
        decision: "use_fresh",
        explanation: "The current listing confirms the updated venue.",
      },
    ],
    candidate: c,
  };
  const reviewNow = new Date("2026-09-01T13:05:00.000Z");
  const db = openSqliteDatabase(path);
  assert.throws(
    () =>
      previewRecovery(
        db,
        saved.source_id,
        { ...supplied, reviewed_run_ids: [] },
        reviewNow,
        target,
      ),
    /history_unacknowledged/,
  );
  assert.throws(
    () =>
      previewRecovery(
        db,
        saved.source_id,
        {
          ...supplied,
          conflicts: [{ ...supplied.conflicts[0], decision: "unresolved" }],
        },
        reviewNow,
        target,
      ),
    /conflict_unresolved/,
  );
  assert.throws(
    () =>
      previewRecovery(
        db,
        saved.source_id,
        supplied,
        new Date("2026-09-03T13:05:00Z"),
        target,
      ),
    /stale_recovery_evidence/,
  );
  const preview = previewRecovery(
    db,
    saved.source_id,
    supplied,
    reviewNow,
    target,
  );
  assert.equal(preview.draft.address_line, "West 30th Street");
  assert.ok(
    preview.warnings.some((warning) =>
      warning.includes("Timezone was not stated"),
    ),
  );
  assert.ok(
    preview.warnings.some((warning) =>
      warning.includes("Admission price stays unknown"),
    ),
  );
  const aliasRun = await repo.start(careerOptions);
  await repo.checkpoint(aliasRun, {
    research_report: "Retained alias report",
    consulted_urls: [
      url.replace("meetup.com/", "www.meetup.com/") + "?utm_source=old",
    ],
  });
  assert.throws(
    () => previewRecovery(db, saved.source_id, supplied, reviewNow, target),
    /history_unacknowledged/,
  );
  supplied.reviewed_run_ids.push(aliasRun);
  const acknowledged = previewRecovery(
    db,
    saved.source_id,
    supplied,
    reviewNow,
    target,
  );
  preview.token = acknowledged.token;
  assert.throws(
    () =>
      applyRecovery(
        db,
        saved.source_id,
        { ...supplied, resolution_note: "changed" },
        preview.token,
        reviewNow,
        target,
      ),
    /stale_recovery_preview/,
  );
  assert.equal(
    db.prepare("select count(*) as count from events").get().count,
    0,
  );
  db.exec(
    "create trigger synthetic_audit_failure before insert on lead_recovery_audits begin select raise(abort, 'synthetic audit failure'); end",
  );
  assert.throws(
    () =>
      applyRecovery(
        db,
        saved.source_id,
        supplied,
        preview.token,
        reviewNow,
        target,
      ),
    /synthetic audit failure/,
  );
  assert.equal(
    db.prepare("select count(*) as count from events").get().count,
    0,
  );
  assert.equal(
    db.prepare("select event_id from event_sources").get().event_id,
    null,
  );
  db.exec("drop trigger synthetic_audit_failure");
  const applied = applyRecovery(
    db,
    saved.source_id,
    supplied,
    preview.token,
    reviewNow,
    target,
  );
  assert.equal(applied.publication_status, "draft");
  const audit = db
    .prepare("select snapshot from lead_recovery_audits")
    .get().snapshot;
  assert.match(audit, /East 39th Street/);
  assert.match(audit, /West 30th Street/);
  assert.equal(
    db.prepare("select discovered_by_run_id from event_sources").get()
      .discovered_by_run_id,
    runId,
  );
  assert.throws(
    () =>
      applyRecovery(
        db,
        saved.source_id,
        supplied,
        preview.token,
        reviewNow,
        target,
      ),
    /linked/,
  );
  db.close();
  const file = join(dir, "private.json");
  await writeFile(file, JSON.stringify(supplied), { mode: 0o600 });
  assert.equal(
    (await readRecoveryEvidence(file)).evidence_kind,
    "reviewer_transcription",
  );
  assert.throws(
    () => parseLeadArgs(["apply", "--source", saved.source_id, "--file", file]),
    /approval_required/,
  );
  assert.match((await runLeadCli([])).help, /SQLite/);
  await assert.rejects(
    () => runLeadCli(["list"], { DATABASE_BACKEND: "supabase" }),
    /sqlite_only/,
  );
});

test("career grounding isolates multi-event reports and rejects ambiguous source sections", () => {
  const second = "https://luma.com/synthetic-other";
  const text = `### 1. First event\n${url}\nFirst private evidence.\n### 2. Other event\n${second}\nOther private evidence.`;
  assert.match(careerSourceEvidence(text, url, 2), /First private evidence/);
  assert.doesNotMatch(
    careerSourceEvidence(text, url, 2),
    /Other private evidence/,
  );
  assert.throws(
    () => careerSourceEvidence(`${text}\n${url}`, url, 2),
    /ambiguous/,
  );
  assert.throws(
    () => careerSourceEvidence(`Unscoped ${url} ${second}`, url, 2),
    /ambiguous/,
  );
});

test("version-one SQLite migration preserves rows and failed refreshes preserve career assessments", async () => {
  const { path } = await temporary();
  let db = openSqliteDatabase(path);
  db.exec(
    "drop table lead_recovery_audits; alter table events drop column career_assessment; pragma user_version = 1",
  );
  db.close();
  const repo = repository(path);
  const runId = await repo.start(careerOptions);
  const identity = sourceIdentity(url);
  const saved = await repo.save(
    runId,
    { ...identity, content_text: evidence },
    normalize(),
    now.toISOString(),
  );
  await repo.save(
    runId,
    { ...identity, error_code: "invalid_candidate" },
    null,
    now.toISOString(),
  );
  db = openSqliteDatabase(path);
  assert.equal(
    JSON.parse(
      db.prepare("select career_assessment from events").get()
        .career_assessment,
    ).score,
    95,
  );
  assert.equal(
    db.prepare("select content_text from event_sources").get().content_text,
    evidence,
  );
  assert.equal(db.prepare("pragma user_version").get().user_version, 2);
  db.prepare(
    "update events set founder_score=83, investor_score=74, networking_score=80 where id=?",
  ).run(saved.event_id);
  db.close();
  const founder = normalizeCandidate(
    candidate(),
    identity,
    report,
    options,
    now.toISOString(),
  );
  await repo.save(
    runId,
    { ...identity, content_text: report },
    founder,
    now.toISOString(),
  );
  db = openSqliteDatabase(path);
  const refreshed = db
    .prepare(
      "select career_assessment, founder_score, investor_score, networking_score from events",
    )
    .get();
  assert.equal(refreshed.career_assessment, null);
  assert.equal(refreshed.founder_score, 83);
  assert.equal(refreshed.investor_score, 74);
  assert.equal(refreshed.networking_score, 80);
  db.close();
});

test("invalid direct provider budgets fail before any network request", async () => {
  let requests = 0;
  const provider = new OpenRouterSearchProvider(
    "synthetic",
    "vendor/test",
    "medium",
    async () => {
      requests++;
      throw new Error("network forbidden");
    },
  );
  await assert.rejects(
    provider.research(
      { ...careerOptions, searches: 13 },
      new AbortController().signal,
    ),
    /invalid_search_options/,
  );
  await assert.rejects(
    provider.research(
      { ...options, searches: 4 },
      new AbortController().signal,
    ),
    /invalid_search_options/,
  );
  assert.equal(requests, 0);
  await assert.rejects(
    provider.research(
      { ...careerOptions, career_target: undefined },
      new AbortController().signal,
    ),
    /invalid_career_config/,
  );
  assert.equal(requests, 0);
});

test("career Supabase preflight fails before research when the additive column is unavailable", async () => {
  const calls = [];
  const client = createClient("http://127.0.0.1:54321", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        calls.push(String(input));
        return String(input).includes("/events?")
          ? Response.json(
              { code: "42703", message: "PRIVATE COLUMN ERROR" },
              { status: 400 },
            )
          : Response.json([]);
      },
    },
  });
  let researchRequests = 0;
  await assert.rejects(
    runIngestion(careerOptions, {
      repository: new SupabaseIngestionRepository(client),
      provider: {
        async research() {
          researchRequests++;
          throw new Error("paid requests forbidden");
        },
      },
      now: () => now,
      signal: new AbortController().signal,
    }),
    /career_migration_required/,
  );
  assert.equal(researchRequests, 0);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("career_assessment"));
});

test("explicit import retains career assessment, IDs and private evidence without publishing", async () => {
  const { path } = await temporary();
  const repo = repository(path);
  const runId = await repo.start(careerOptions);
  const saved = await repo.save(
    runId,
    {
      ...sourceIdentity(url),
      content_text: evidence,
      raw_payload: { private_evidence: "synthetic" },
    },
    normalize(),
    now.toISOString(),
  );
  const db = openSqliteDatabase(path);
  const jsonColumns = new Set([
    "search_parameters",
    "metadata",
    "categories",
    "career_assessment",
    "raw_payload",
    "review_snapshot",
  ]);
  const tables = [
    "search_runs",
    "events",
    "event_sources",
    "event_publication_reviews",
  ];
  const snapshot = Object.fromEntries(
    tables.map((table) => [
      table,
      db
        .prepare(`select * from ${table}`)
        .all()
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              jsonColumns.has(key) && value !== null
                ? JSON.parse(value)
                : key === "is_fixture"
                  ? Boolean(value)
                  : value,
            ]),
          ),
        ),
    ]),
  );
  db.close();
  const destination = (await temporary()).path;
  importSupabaseSnapshot(snapshot, destination);
  const imported = openSqliteDatabase(destination);
  const event = imported
    .prepare("select id, career_assessment, publication_status from events")
    .get();
  assert.equal(event.id, saved.event_id);
  assert.equal(JSON.parse(event.career_assessment).score, 95);
  assert.equal(event.publication_status, "draft");
  assert.equal(
    imported.prepare("select content_text from event_sources").get()
      .content_text,
    evidence,
  );
  imported.close();
});

test("a malformed repair preserves a valid career sibling without retry or invented fields", async () => {
  const second = "https://luma.com/synthetic-other";
  const original = careerCandidate();
  const malformed = {
    ...careerCandidate(),
    source_url: second,
    title: "malformed-fact",
  };
  const bodies = [];
  const responses = [
    JSON.stringify({ candidates: [original, malformed] }),
    "not JSON",
  ];
  const provider = new OpenRouterSearchProvider(
    "synthetic",
    "vendor/test",
    "medium",
    async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return Response.json({
        id: "gen-synthetic",
        model: "vendor/test",
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: responses.shift() },
          },
        ],
        usage: {
          server_tool_use: {
            web_search_requests: 0,
            web_fetch_requests: bodies.length === 1 ? 2 : 0,
          },
        },
      });
    },
  );
  const extracted = await provider.extract(
    { report: evidence, urls: [url, second], metadata: {} },
    [sourceIdentity(url), sourceIdentity(second)],
    careerOptions,
    new AbortController().signal,
  );
  assert.deepEqual(extracted.candidates, [original, malformed]);
  assert.equal(extracted.metadata.repair.error_code, "invalid_repair_json");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].tools, undefined);
  assert.match(
    bodies[1].messages[0].content,
    /Required schema:.*product_relevance/,
  );
  assert.equal(provider.getDiagnostics()[1].phase, "repair");
});
