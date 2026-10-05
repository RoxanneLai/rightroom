import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { readDashboardConfig } from "../../lib/dashboard/config.ts";
import {
  loadDashboard,
  PUBLIC_EVENT_COLUMNS,
} from "../../lib/dashboard/repository.ts";
import { env, fakeKey, now, publishedRow } from "./helpers.mjs";

test("Supabase career reads request career ordering and expose no evidence or unassessed drafts", async () => {
  const assessment = (score) => ({
    version: "career-score-v1",
    profile_version: "career-v1",
    score,
    components: {
      role_fit: score,
      people: 0,
      interaction: 0,
      domain: 0,
      access: 0,
    },
    reasons: ["direct_product_fit"],
    cautions: ["hiring_unknown"],
    confidence: "needs_checking",
    founderAccess: "not_applicable",
    hiring: null,
  });
  const fetch = async (input) => {
    const requested = new URL(String(input));
    assert.match(
      requested.searchParams.get("order"),
      /^career_assessment->score.desc/,
    );
    assert.equal(
      requested.searchParams.get("career_assessment"),
      "not.is.null",
    );
    assert.doesNotMatch(
      requested.searchParams.get("select"),
      /raw_payload|content_text|search_runs/,
    );
    return Response.json([
      publishedRow({
        id: "10000000-0000-4000-8000-000000000001",
        career_assessment: assessment(20),
        networking_score: 99,
      }),
      publishedRow({
        id: "10000000-0000-4000-8000-000000000002",
        career_assessment: { ...assessment(30), version: "career-score-v2" },
        networking_score: 1,
      }),
      publishedRow({
        id: "10000000-0000-4000-8000-000000000003",
        career_assessment: {
          ...assessment(40),
          version: "career-score-v3",
          cautions: ["role_evidence_limited", "interaction_evidence_limited"],
        },
      }),
      publishedRow({
        publication_status: "draft",
        career_assessment: assessment(95),
        raw_payload: "PRIVATE",
      }),
      publishedRow({
        career_assessment: assessment(100),
        registration_status: "closed",
      }),
      publishedRow(),
    ]);
  };
  const result = await loadDashboard({ env, now, fetch, career: true });
  assert.equal(result.status, "ready");
  assert.deepEqual(
    result.events.map((event) => event.careerAssessment.score),
    [40, 30, 20],
  );
  assert.deepEqual(
    result.events.map((event) => event.careerAssessment.version),
    ["career-score-v3", "career-score-v2", "career-score-v1"],
  );
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|raw_payload/);
});

async function temporaryDatabasePath() {
  await mkdir("codex-tmp", { recursive: true });
  const directory = await mkdtemp("codex-tmp/dashboard-sqlite-");
  return { directory, path: join(directory, "dashboard.sqlite") };
}

test("dashboard credentials accept anonymous local access, never elevated or hosted keys", () => {
  assert.deepEqual(readDashboardConfig(env), {
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
  });
  assert.equal(readDashboardConfig({}), null);
  assert.deepEqual(readDashboardConfig({ SUPABASE_URL: env.SUPABASE_URL }), {
    url: env.SUPABASE_URL,
    anonKey: null,
  });
  assert.equal(
    readDashboardConfig({ SUPABASE_SERVICE_ROLE_KEY: "unused" }),
    null,
  );
  for (const override of [
    { SUPABASE_ANON_KEY: fakeKey("service_role") },
    { SUPABASE_ANON_KEY: fakeKey("authenticated") },
    { SUPABASE_ANON_KEY: "sb_secret_not_allowed" },
    { SUPABASE_ANON_KEY: "malformed" },
    { SUPABASE_URL: "https://project.supabase.co" },
    { SUPABASE_URL: "http://127.0.0.1" },
    { SUPABASE_URL: "http://user:password@127.0.0.1:54321" },
    { SUPABASE_URL: "http://127.0.0.1:54321/path" },
    { SUPABASE_URL: "http://127.0.0.1:54321?key=value" },
  ])
    assert.throws(() => readDashboardConfig({ ...env, ...override }));
});

test("auth-disabled local Supabase uses a credential-free anonymous request", async () => {
  let calls = 0;
  const result = await loadDashboard({
    env: {
      DATABASE_BACKEND: "supabase",
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: "NEVER SEND THIS",
    },
    now,
    fetch: async (_input, init) => {
      calls += 1;
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), null);
      assert.equal(headers.get("apikey"), null);
      assert.doesNotMatch(
        JSON.stringify([...headers]),
        /NEVER SEND|local-anonymous/,
      );
      return Response.json([]);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "empty");
});

test("missing or unsafe configuration performs no network requests and leaks no credentials", async () => {
  const fetch = async () => assert.fail("Network not permitted");
  const temporary = await temporaryDatabasePath();
  assert.equal(
    (
      await loadDashboard({
        env: { SQLITE_DATABASE_PATH: temporary.path },
        fetch,
      })
    ).status,
    "empty",
  );
  const result = await loadDashboard({
    env: { ...env, SUPABASE_ANON_KEY: "private-key" },
    fetch,
  });
  assert.deepEqual(result, {
    status: "unavailable",
    events: [],
    hasMore: false,
  });
});

test("real SDK uses only a bounded, uncached anonymous GET with explicit visibility filters", async () => {
  let calls = 0;
  const result = await loadDashboard({
    env,
    now,
    fetch: async (input, init) => {
      calls += 1;
      const url = new URL(String(input));
      const headers = new Headers(init.headers);
      assert.equal(url.origin, env.SUPABASE_URL);
      assert.equal(url.pathname, "/rest/v1/events");
      assert.equal(init.method, "GET");
      assert.equal(init.cache, "no-store");
      assert.equal(init.redirect, "error");
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(headers.get("apikey"), env.SUPABASE_ANON_KEY);
      assert.equal(
        headers.get("authorization"),
        `Bearer ${env.SUPABASE_ANON_KEY}`,
      );
      assert.equal(url.searchParams.get("select"), PUBLIC_EVENT_COLUMNS);
      assert.doesNotMatch(
        PUBLIC_EVENT_COLUMNS,
        /\*|event_sources|search_runs|raw_payload|content_text/,
      );
      for (const [name, value] of Object.entries({
        publication_status: "eq.published",
        is_fixture: "eq.false",
        city: "eq.New York",
        region: "eq.NY",
        country_code: "eq.US",
        time_zone: "eq.America/New_York",
        event_format: "in.(in-person,hybrid)",
        registration_status: "neq.cancelled",
        limit: "51",
        order: "networking_score.desc.nullslast,starts_at.asc,id.asc",
      }))
        assert.equal(url.searchParams.get(name), value, name);
      assert.deepEqual(url.searchParams.getAll("starts_at"), [
        "gte.2026-09-02T03:00:00.000Z",
        "lt.2026-10-02T03:00:00.000Z",
      ]);
      return Response.json([publishedRow()]);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "ready");
  assert.equal(result.events.length, 1);
});

test("empty, invalid, failed and thrown responses never fall back to sample events", async () => {
  assert.equal(
    (await loadDashboard({ env, now, fetch: async () => Response.json([]) }))
      .status,
    "empty",
  );
  for (const fetch of [
    async () =>
      Response.json({ message: "secret provider text" }, { status: 503 }),
    async () => Response.json([publishedRow({ title: null })]),
    async () => Response.json(null),
    async () => {
      throw new Error("secret provider text");
    },
    async () => {
      throw new DOMException("secret provider text", "AbortError");
    },
  ]) {
    let calls = 0;
    const result = await loadDashboard({
      env,
      now,
      fetch: (...args) => {
        calls += 1;
        return fetch(...args);
      },
    });
    assert.deepEqual(result, {
      status: "unavailable",
      events: [],
      hasMore: false,
    });
    assert.equal(calls, 1);
  }
});

test("even an overbroad response cannot expose drafts, archives or samples", async () => {
  const result = await loadDashboard({
    env,
    now,
    fetch: async () =>
      Response.json([
        publishedRow({ publication_status: "draft", title: "PRIVATE DRAFT" }),
        publishedRow({
          publication_status: "archived",
          title: "PRIVATE ARCHIVE",
        }),
        publishedRow({ is_fixture: true, title: "SAMPLE" }),
        publishedRow(),
      ]),
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(
    result.events.map((event) => event.title),
    ["Synthetic published event"],
  );
});

test("a bounded extra row indicates more events without displaying over 50", async () => {
  const rows = Array.from({ length: 51 }, (_, index) =>
    publishedRow({
      id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }),
  );
  const result = await loadDashboard({
    env,
    now,
    fetch: async () => Response.json(rows),
  });
  assert.equal(result.events.length, 50);
  assert.equal(result.hasMore, true);
});
