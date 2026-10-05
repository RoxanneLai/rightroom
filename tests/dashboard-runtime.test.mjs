import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import next from "next";
import { fakeKey, publishedRow } from "./dashboard/helpers.mjs";
import { assertDashboardHtml } from "./assert-dashboard.mjs";

let databaseServer;
let appServer;
let app;
let appUrl;
let databaseUrl;
let responseRows = [];
let responseStatus = 200;
let delay = 0;
let databaseCalls = 0;
let lastDatabaseHeaders;
const originalEnv = {
  DATABASE_BACKEND: process.env.DATABASE_BACKEND,
  SQLITE_DATABASE_PATH: process.env.SQLITE_DATABASE_PATH,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
};

const careerAssessment = {
  version: "career-score-v1",
  profile_version: "career-v1",
  score: 80,
  components: {
    role_fit: 30,
    people: 25,
    interaction: 10,
    domain: 15,
    access: 0,
  },
  reasons: ["direct_product_fit", "relevant_people", "qa", "preferred_domain"],
  cautions: ["hiring_unknown", "price_unknown", "participation_not_guaranteed"],
  confidence: "needs_checking",
  founderAccess: "not_applicable",
  hiring: null,
};

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

function upcomingRow(overrides = {}) {
  return publishedRow({
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    ...overrides,
  });
}

async function page(path = "/events", userAgent = "Googlebot") {
  const response = await fetch(appUrl + path, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200);
  return { html: await response.text(), headers: response.headers };
}

before(
  async () => {
    databaseServer = createServer(async (request, response) => {
      databaseCalls += 1;
      lastDatabaseHeaders = request.headers;
      if (
        request.method !== "GET" ||
        !request.url.startsWith("/rest/v1/events?")
      ) {
        response.writeHead(405).end();
        return;
      }
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      response.writeHead(responseStatus, {
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify(
          responseStatus === 200
            ? responseRows
            : { message: "PRIVATE PROVIDER ERROR" },
        ),
      );
    });
    databaseUrl = await listen(databaseServer);
    process.env.DATABASE_BACKEND = "supabase";
    delete process.env.SQLITE_DATABASE_PATH;
    process.env.SUPABASE_URL = databaseUrl;
    process.env.SUPABASE_ANON_KEY = fakeKey();
    app = next({ dev: false, dir: process.cwd() });
    await app.prepare();
    const handle = app.getRequestHandler();
    appServer = createServer((request, response) => handle(request, response));
    appUrl = await listen(appServer);
  },
  { timeout: 30000 },
);

after(async () => {
  await close(appServer);
  if (app) await app.close();
  await close(databaseServer);
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("production cards expose reviewed registration links without leaking private URLs", async () => {
  responseRows = [
    upcomingRow({
      public_registration_url: "https://luma.com/synthetic-reviewed-event",
      source_url: "https://luma.com/private?token=secret",
    }),
  ];
  let { html } = await page();
  assert.match(html, /href="https:\/\/luma.com\/synthetic-reviewed-event"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /referrerPolicy="no-referrer"/i);
  assert.match(html, /View event &amp; registration/);
  assert.doesNotMatch(html, /token=secret|luma.com\/private/);
  responseRows = [
    upcomingRow({
      public_registration_url:
        "https://luma.com/synthetic-reviewed-event?secret=private",
    }),
  ];
  ({ html } = await page());
  assert.match(html, /Registration link not available/);
  assert.doesNotMatch(html, /secret=private/);
});

test("production route renders fresh published records and never exposes private fields", async () => {
  responseRows = [
    upcomingRow({
      title: "Runtime published record",
      raw_payload: "PRIVATE SOURCE PAYLOAD",
    }),
    upcomingRow({ title: "PRIVATE DRAFT TITLE", publication_status: "draft" }),
    upcomingRow({
      title: "PRIVATE ARCHIVE TITLE",
      publication_status: "archived",
    }),
    upcomingRow({ title: "HIDDEN FIXTURE TITLE", is_fixture: true }),
  ];
  const { html, headers } = await page();
  assert.match(html, /Runtime published record/);
  assert.match(html, /Price not listed/);
  assert.match(html, /Not scored/);
  assert.match(html, /Organizer not listed/);
  assert.match(html, /End time not listed/);
  assert.match(html, /Recommendation pending/);
  assert.match(html, /Registration status not listed/);
  assert.doesNotMatch(
    html,
    /PRIVATE|HIDDEN FIXTURE|test-signature|sb_secret|Sample listing · no registration/,
  );
  assert.doesNotMatch(html, /Networking score: 0 out of 100/);
  assert.equal((html.match(/<article\b/g) ?? []).length, 1);
  assert.match(headers.get("cache-control") ?? "", /no-store/);
  const callsBefore = databaseCalls;
  responseRows = [
    upcomingRow({
      title: "Updated record after first request",
      price_amount_cents: 1250,
      currency_code: "USD",
      networking_score: 0,
    }),
  ];
  const updated = await page();
  assert.match(updated.html, /Updated record after first request/);
  assert.doesNotMatch(updated.html, /Runtime published record/);
  assert.match(updated.html, /\$12.50/);
  assert.match(updated.html, /Networking score: 0 out of 100/);
  assert.equal(databaseCalls, callsBefore + 1);
});

test("homepage and career alias rank published career assessments without leaking founder-only or private data", async () => {
  const assessment = careerAssessment;
  responseRows = [
    upcomingRow({
      title: "Published career example",
      career_assessment: assessment,
      networking_score: 100,
      raw_payload: "PRIVATE CAREER QUOTE",
    }),
    upcomingRow({
      id: "d9d2e317-b328-421e-8f2c-f9152ee0317d",
      title: "Higher career fit example",
      career_assessment: {
        ...assessment,
        version: "career-score-v4",
        score: 90,
        components: { ...assessment.components, interaction: 20 },
        reasons: [
          ...assessment.reasons.filter((reason) => reason !== "qa"),
          "networking",
        ],
      },
      networking_score: 0,
    }),
    upcomingRow({
      id: "d9d2e317-b328-421e-8f2c-f9152ee0317e",
      title: "Limited career evidence example",
      career_assessment: {
        ...assessment,
        version: "career-score-v3",
        score: 22.5,
        components: {
          role_fit: 22.5,
          people: 0,
          interaction: 0,
          domain: 0,
          access: 0,
        },
        reasons: ["adjacent_product_fit"],
        cautions: ["role_evidence_limited", "interaction_evidence_limited"],
      },
      raw_payload: "PRIVATE LIMITED QUOTE",
    }),
    upcomingRow({
      title: "PRIVATE CAREER DRAFT",
      career_assessment: assessment,
      publication_status: "draft",
    }),
    upcomingRow({ title: "Unassessed founder event" }),
    upcomingRow({
      title: "PRIVATE CAREER FIXTURE",
      career_assessment: assessment,
      is_fixture: true,
    }),
    upcomingRow({
      title: "PRIVATE CAREER ARCHIVE",
      career_assessment: assessment,
      publication_status: "archived",
    }),
    upcomingRow({
      title: "Closed career registration",
      career_assessment: assessment,
      registration_status: "closed",
    }),
  ];
  for (const route of ["/", "/career"]) {
    const { html, headers } = await page(route);
    assert.match(html, /Published career example/);
    assert.match(html, /Higher career fit example/);
    assert.match(html, /Limited career evidence example/);
    assert.match(html, /Role relevance needs checking/);
    assert.match(html, /no interaction credit/);
    assert.ok(
      html.indexOf("Higher career fit example") <
        html.indexOf("Published career example"),
    );
    assert.match(html, /Career fit/);
    assert.match(html, /Hiring/);
    assert.match(html, /href="\/events"[^>]*>All events/);
    assert.match(
      html,
      /<a\b(?=[^>]*href="\/sample\/career")(?=[^>]*class="edition-link")[^>]*>/,
    );
    assert.doesNotMatch(
      html,
      /PRIVATE|Unassessed founder event|Closed career registration/,
    );
    assert.equal((html.match(/<article\b/g) ?? []).length, 3);
    assert.match(headers.get("cache-control") ?? "", /no-store/);
  }
  assert.match((await page("/events")).html, /Unassessed founder event/);
  const callsBefore = databaseCalls;
  const sample = await page("/sample/career");
  assert.match(sample.html, /fictional career shortlist/i);
  assert.match(
    sample.html,
    /<strong>03<\/strong>\s*<span>with career-fit scores<\/span>/,
  );
  assert.match(
    sample.html,
    /<a\b(?=[^>]*href="\/")(?=[^>]*class="edition-link")[^>]*>/,
  );
  assert.equal(databaseCalls, callsBefore);
});

test("career homepage distinguishes an empty career shortlist and retries its own edition", async () => {
  responseRows = [upcomingRow({ title: "Founder-only published listing" })];
  const empty = await page("/");
  assert.match(empty.html, /No published career events yet/);
  assert.match(empty.html, /Browse all published events/);
  assert.match(empty.html, /href="\/sample\/career"/);
  assert.doesNotMatch(empty.html, /Founder-only published listing|<article\b/);
  assert.match((await page("/events")).html, /Founder-only published listing/);
  responseStatus = 503;
  try {
    const career = await page("/");
    assert.match(career.html, /form action="\/" method="get"/);
    assert.match(career.html, /href="\/sample\/career"/);
    assert.doesNotMatch(career.html, /PRIVATE PROVIDER ERROR/);
    const all = await page("/events");
    assert.match(all.html, /form action="\/events" method="get"/);
    assert.match(all.html, /href="\/sample"/);
  } finally {
    responseStatus = 200;
  }
});

test("production route distinguishes an empty database from a connection failure and recovers", async () => {
  responseRows = [];
  assert.match((await page()).html, /No published events yet/);
  responseStatus = 503;
  const callsBefore = databaseCalls;
  const { html } = await page();
  assert.match(html, /The event feed is temporarily unavailable/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /PRIVATE PROVIDER ERROR|mock-\d|Sample listing/);
  assert.equal(databaseCalls, callsBefore + 1);
  responseStatus = 200;
  responseRows = [upcomingRow({ title: "Recovered database record" })];
  assert.match((await page()).html, /Recovered database record/);
});

test("runtime configuration is read at request time without freezing it into the build", async () => {
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_ANON_KEY = "";
  const callsBefore = databaseCalls;
  const { html } = await page();
  assert.match(html, /The event feed is not connected yet/);
  assert.doesNotMatch(html, /<article\b/);
  assert.equal(databaseCalls, callsBefore);
  process.env.SUPABASE_URL = databaseUrl;
  process.env.SUPABASE_ANON_KEY = fakeKey();
});

test("a fresh SQLite-backed career homepage needs no Supabase configuration", async () => {
  await mkdir("codex-tmp", { recursive: true });
  const dir = await mkdtemp(resolve("codex-tmp/career-home-runtime-"));
  const path = join(dir, "isolated.sqlite");
  const callsBefore = databaseCalls;
  delete process.env.DATABASE_BACKEND;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  process.env.SQLITE_DATABASE_PATH = path;
  try {
    const { html } = await page("/");
    assert.match(html, /No published career events yet/);
    assert.match(html, /Browse all published events/);
    assert.doesNotMatch(
      html,
      /<article\b|temporarily unavailable|not connected yet/,
    );
    assert.equal((await stat(path)).isFile(), true);
    assert.match((await page("/events")).html, /No published events yet/);
    assert.equal(databaseCalls, callsBefore);
  } finally {
    process.env.DATABASE_BACKEND = "supabase";
    process.env.SUPABASE_URL = databaseUrl;
    process.env.SUPABASE_ANON_KEY = fakeKey();
    delete process.env.SQLITE_DATABASE_PATH;
  }
});

test("the sample route remains available without touching the database", async () => {
  const callsBefore = databaseCalls;
  const { html } = await page("/sample");
  assertDashboardHtml(html);
  assert.equal(databaseCalls, callsBefore);
});

test("auth-disabled local mode sends no placeholder or privileged credentials", async () => {
  process.env.SUPABASE_ANON_KEY = "";
  responseRows = [upcomingRow({ title: "Anonymous local record" })];
  try {
    const { html } = await page();
    assert.match(html, /Anonymous local record/);
    assert.equal(lastDatabaseHeaders.authorization, undefined);
    assert.equal(lastDatabaseHeaders.apikey, undefined);
    assert.doesNotMatch(html, /local-anonymous|test-signature/);
  } finally {
    process.env.SUPABASE_ANON_KEY = fakeKey();
  }
});

test("browser requests stream edition-specific loading before career and all-events results", async () => {
  delay = 500;
  responseRows = [
    upcomingRow({
      title: "Delayed published record",
      career_assessment: careerAssessment,
    }),
  ];
  try {
    for (const [route, label] of [
      ["/", "Career fit"],
      ["/events", "Score ↓"],
    ]) {
      const response = await fetch(appUrl + route, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(15000),
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let first = "";
      while (!first.includes("Loading your shortlist")) {
        const chunk = await reader.read();
        assert.equal(
          chunk.done,
          false,
          "Expected loading state before the stream ended",
        );
        first += decoder.decode(chunk.value, { stream: true });
      }
      assert.doesNotMatch(first, /Delayed published record/);
      assert.match(first, new RegExp(label));
      let rest = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        rest += decoder.decode(chunk.value, { stream: true });
      }
      assert.match(rest, /Delayed published record/);
    }
  } finally {
    delay = 0;
  }
});
