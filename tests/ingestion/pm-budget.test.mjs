import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  acceptanceBudgetEnvelope,
  acceptanceTransport,
  assertAcceptanceBudget,
  assertKeyAccess,
  PM_MODEL,
  PM_BUDGET_USD,
} from "../../lib/ingestion/acceptance-budget.ts";
import {
  API_LIMITS,
  OpenRouterSearchProvider,
} from "../../lib/ingestion/openrouter-provider.ts";
import {
  ALLOWED_DOMAINS,
  sourceIdentity,
} from "../../lib/ingestion/sources.ts";
import {
  parsePmMode,
  preparePmPlan,
  preflightPmBudget,
  runPmAcceptance,
  inspectPmDatabase,
  snapshotPmRun,
} from "../../lib/ingestion/pm-acceptance.ts";
import { errorCode } from "../../lib/ingestion/errors.ts";
import { captureSourcePage } from "../../lib/ingestion/source-capture.ts";
import { runIngestion } from "../../lib/ingestion/run.ts";
import { SqliteIngestionRepository } from "../../lib/ingestion/sqlite-repository.ts";
import {
  fixture,
  manifest,
  listing,
  databasePath,
  clock,
  rows,
  ingest,
} from "./offline-acceptance-helpers.mjs";
import { options, url } from "./helpers.mjs";
import { readCareerTarget } from "../../lib/career/profile.ts";

const endpoint = "https://openrouter.ai/api/v1/chat/completions";
const syntheticCatalog = () => ({
  id: PM_MODEL,
  context_length: 16384,
  supported_parameters: [
    "tools",
    "tool_choice",
    "response_format",
    "structured_outputs",
    "reasoning",
    "max_tokens",
  ],
  reasoning: { supported_efforts: ["medium"] },
  pricing: { prompt: "0.0000001", completion: "0.0000006" },
});
const envelope = () => acceptanceBudgetEnvelope(syntheticCatalog());
const response = (content = "{}", cost = 0.001, citations = []) =>
  new Response(
    JSON.stringify({
      id: "gen-synthetic-pm-budget",
      model: PM_MODEL,
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content,
            annotations: citations.map((url) => ({
              type: "url_citation",
              url_citation: { url },
            })),
          },
        },
      ],
      usage: {
        cost,
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        server_tool_use: citations.length ? { web_search_requests: 1 } : {},
      },
    }),
  );

function request(phase = "research", overrides = {}) {
  return {
    model: PM_MODEL,
    stream: false,
    provider: { require_parameters: true, allow_fallbacks: false },
    reasoning: { effort: "medium", exclude: true },
    messages: [
      { role: "system", content: "Synthetic system" },
      { role: "user", content: "Synthetic user" },
    ],
    max_tokens: {
      research: API_LIMITS.researchOutputTokens,
      extraction: API_LIMITS.extractionOutputTokens,
      repair: API_LIMITS.repairOutputTokens,
    }[phase],
    ...(phase === "research"
      ? {
          tools: [
            {
              type: "openrouter:web_search",
              parameters: {
                engine: "exa",
                mode: "auto",
                max_uses: 3,
                max_results: 5,
                max_total_results: 15,
                max_characters: 2000,
                allowed_domains: [...ALLOWED_DOMAINS],
              },
            },
          ],
          tool_choice: "required",
          max_tool_calls: 3,
        }
      : {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "synthetic",
              strict: true,
              schema: { type: "object" },
            },
          },
        }),
    ...overrides,
  };
}

const invoke = (transport, phase = "research", overrides = {}) =>
  transport(endpoint, {
    method: "POST",
    body: JSON.stringify(request(phase, overrides)),
  });

async function temporaryDirectory() {
  await mkdir("codex-tmp", { recursive: true });
  const path = await mkdtemp(resolve("codex-tmp/pm-budget-test-"));
  await chmod(path, 0o700);
  return path;
}

test("PM acceptance defaults to a free plan and rejects extra, duplicate and budget-changing flags", () => {
  assert.equal(parsePmMode([]), "plan");
  for (const mode of ["plan", "preflight", "live"])
    assert.equal(parsePmMode(["--" + mode]), mode);
  for (const args of [
    ["--budget", "1"],
    ["--live", "--live"],
    ["--live", "--preflight"],
    [""],
    ["--retry"],
  ])
    assert.throws(() => parsePmMode(args), /invalid_pm_acceptance_arguments/);
  assert.equal(PM_BUDGET_USD, 0.15);
});

test("PM plan pins fresh fourteen-day product expansion without pretending to verify prices", async () => {
  const plan = await preparePmPlan(clock);
  assert.equal(plan.options.from, clock.toISOString());
  assert.equal(Date.parse(plan.options.to) - clock.getTime(), 14 * 86400000);
  assert.equal(plan.options.search_focus, "product");
  assert.equal(plan.options.intent, "expand");
  assert.equal(plan.options.limit, 3);
  assert.equal(plan.options.searches, 3);
  assert.equal(plan.model, PM_MODEL);
  assert.equal(plan.effort, "medium");
  assert.equal(plan.repair.model, PM_MODEL);
  assert.equal(plan.budget_verified, false);
  assert.ok(plan.planned_queries.every(({ family }) => family === "product"));
  assert.equal(plan.paid_calls, false);
});

test("actual runner plan and malformed arguments read no key, network or storage", async () => {
  const dir = await temporaryDirectory();
  await mkdir(join(dir, "config"));
  for (const name of ["career.json", "ingestion.json"])
    await writeFile(
      join(dir, "config", name),
      await readFile("config/" + name),
    );
  await mkdir(join(dir, "OPENROUTER.key"));
  for (const args of [
    [],
    ["--plan"],
    ["--budget", "0.99"],
    ["--live", "--live"],
    ["--live"],
  ]) {
    const bootstrap = `
      import http from 'node:http'; import https from 'node:https'; import dns from 'node:dns/promises';
      const blocked=()=>{throw new Error('unexpected network')}; globalThis.fetch=blocked; http.request=blocked; https.request=blocked; dns.lookup=blocked;
      process.argv=['node','pm',...${JSON.stringify(args)}];
      await import(${JSON.stringify(pathToFileURL(resolve("scripts/run-pm-discovery.ts")).href)});
    `;
    const child = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        bootstrap,
      ],
      {
        cwd: dir,
        encoding: "utf8",
        timeout: 10000,
        env: {
          PATH: process.env.PATH,
          DATABASE_BACKEND: "must-not-read",
          SQLITE_DATABASE_PATH: join(dir, "must-not-create.sqlite"),
          FOUNDER_RADAR_ALLOW_PAID_API: "0",
        },
      },
    );
    assert.equal(
      child.status,
      args.length === 0 || args[0] === "--plan" ? 0 : 1,
    );
    assert.doesNotMatch(
      child.stderr,
      /unexpected network|key_file_unavailable|invalid_database_backend/,
    );
  }
  assert.deepEqual((await readdir(dir)).sort(), ["OPENROUTER.key", "config"]);
});

test("whole-attempt budget reserves all full contexts, continuations, outputs and Exa searches", () => {
  const value = envelope();
  assert.ok(
    value.reservations_usd.research >=
      4 * (16384 * 0.0000001 + 6000 * 0.0000006) + 0.021,
  );
  assert.ok(
    value.reservations_usd.extraction >= 16384 * 0.0000001 + 12000 * 0.0000006,
  );
  assert.ok(
    value.reservations_usd.repair >= 16384 * 0.0000001 + 6000 * 0.0000006,
  );
  assertAcceptanceBudget(value);
  const current = syntheticCatalog();
  current.context_length = 1_050_000;
  const broad = acceptanceBudgetEnvelope(current);
  assert.throws(
    () => assertAcceptanceBudget(broad),
    /acceptance_budget_exceeded/,
  );
  assert.throws(
    () => acceptanceTransport(broad, () => assert.fail("never reach network")),
    /acceptance_budget_exceeded/,
  );
});

test("higher tiers and cache-write surcharges cannot hide behind cheapest catalog prices", () => {
  const model = syntheticCatalog();
  model.pricing.overrides = [
    {
      min_prompt_tokens: 272000,
      prompt: "0.0000004",
      completion: "0.0000018",
      input_cache_write: "0.0000005",
    },
  ];
  const value = acceptanceBudgetEnvelope(model);
  assert.equal(value.input_usd_per_token, 0.0000009);
  assert.equal(value.output_usd_per_token, 0.0000018);
  assert.throws(
    () => assertAcceptanceBudget(value),
    /acceptance_budget_exceeded/,
  );
});

test("unknown, missing and malformed pricing or capabilities fail closed", () => {
  for (const change of [
    (m) => {
      delete m.pricing;
    },
    (m) => {
      m.id = "another/model";
    },
    (m) => {
      m.pricing.prompt = "";
    },
    (m) => {
      m.pricing.completion = -1;
    },
    (m) => {
      m.pricing.prompt = Infinity;
    },
    (m) => {
      m.pricing.extra_fee = "0.1";
    },
    (m) => {
      m.pricing.request = "0.01";
    },
    (m) => {
      m.pricing.overrides = [{ unrecognized_charge: 1 }];
    },
    (m) => {
      m.reasoning.supported_efforts = ["low"];
    },
    (m) => {
      m.supported_parameters = [];
    },
    (m) => {
      m.context_length = 0;
    },
  ]) {
    const m = syntheticCatalog();
    change(m);
    assert.throws(() => acceptanceBudgetEnvelope(m), /budget_/);
  }
  for (const maximum_usd of [NaN, Infinity, -1, 0.150001])
    assert.throws(
      () => assertAcceptanceBudget({ ...envelope(), maximum_usd }),
      /budget_/,
    );
});

test("public preflight is GET-only, rejects failures safely and never reads a credential", async () => {
  const calls = [];
  const result = await preflightPmBudget(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ data: [syntheticCatalog()] }));
  });
  assert.equal(result.within_ceiling, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers, undefined);
  for (const transport of [
    async () => {
      throw new Error("RAW_SECRET_PROVIDER_ERROR");
    },
    async () => new Response("RAW_SECRET_PROVIDER_ERROR", { status: 403 }),
    async () => new Response("not json"),
  ])
    await assert.rejects(
      preflightPmBudget(transport),
      /pm_access_preflight_failed/,
    );
});

test("over-budget live preflight stops before credential access, backup or database creation", async () => {
  const dir = await temporaryDirectory();
  const output = [];
  const model = syntheticCatalog();
  model.context_length = 1_050_000;
  let calls = 0;
  await assert.rejects(
    runPmAcceptance(
      ["--live"],
      {
        DATABASE_BACKEND: "sqlite",
        SQLITE_DATABASE_PATH: join(dir, "must-not-create.sqlite"),
        FOUNDER_RADAR_ALLOW_PAID_API: "1",
      },
      (value) => output.push(value),
      async (_url, init) => {
        calls++;
        assert.equal(init.method, "GET");
        assert.equal(init.headers, undefined);
        return new Response(JSON.stringify({ data: [model] }));
      },
    ),
    /acceptance_budget_exceeded/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(dir), []);
  const artifacts = output.find(
    (value) => value.private_directory,
  ).private_directory;
  assert.equal((await stat(artifacts)).mode & 0o777, 0o700);
  assert.deepEqual((await readdir(artifacts)).sort(), [
    "budget.json",
    "plan.json",
    "stopped.json",
  ]);
  assert.equal(
    (await stat(join(artifacts, "budget.json"))).mode & 0o777,
    0o600,
  );
  assert.equal(
    JSON.parse(await readFile(join(artifacts, "stopped.json"), "utf8")).error,
    "acceptance_budget_exceeded",
  );
});

test("key checks reject unavailable and expired access without mistaking limits for a guarantee", () => {
  const base = {
    limit: null,
    limit_remaining: null,
    limit_reset: null,
    is_free_tier: false,
  };
  assertKeyAccess({ data: base }, 0.1);
  assertKeyAccess({ data: { ...base, limit: 1, limit_remaining: 0.5 } }, 0.1);
  for (const data of [
    { ...base, is_free_tier: true },
    { ...base, limit: 1, limit_remaining: 0.01 },
    { ...base, expires_at: "invalid" },
    { ...base, expires_at: "2020-01-01T00:00:00Z" },
  ])
    assert.throws(
      () => assertKeyAccess({ data }, 0.1),
      /budget_key_unavailable/,
    );
  assert.throws(() => assertKeyAccess({}), /budget_key_status_unavailable/);
});

test("guarded requests preserve model, effort, tool-free schemas and disable fallback with price filters", async () => {
  const bodies = [];
  const value = envelope();
  const transport = acceptanceTransport(value, async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return response();
  });
  for (const phase of ["research", "extraction", "repair"])
    await invoke(transport, phase);
  await assert.rejects(invoke(transport, "repair"), /budget_request_blocked/);
  assert.equal(bodies.length, 3);
  for (const body of bodies) {
    assert.equal(body.model, PM_MODEL);
    assert.deepEqual(body.reasoning, { effort: "medium", exclude: true });
    assert.deepEqual(body.provider, {
      require_parameters: true,
      allow_fallbacks: false,
      max_price: {
        prompt: value.input_usd_per_token * 1e6,
        completion: value.output_usd_per_token * 1e6,
        request: 0,
      },
    });
  }
  assert.equal(bodies[1].tools, undefined);
  assert.equal(bodies[2].tools, undefined);
  assert.equal(bodies[1].response_format.json_schema.strict, true);
});

test("changed request bounds, plugins, router models, traces and malformed JSON never reach transport", async () => {
  for (const overrides of [
    { plugins: [{ id: "web" }] },
    { model: "openrouter/auto" },
    { max_tokens: 99999 },
    { provider: { allow_fallbacks: true, require_parameters: true } },
    { reasoning: { effort: "medium", exclude: false } },
    { tools: [] },
    { max_tool_calls: 4 },
  ])
    await assert.rejects(
      invoke(
        acceptanceTransport(envelope(), () => assert.fail("no paid calls")),
        "research",
        overrides,
      ),
      /budget_request_blocked/,
    );
  await assert.rejects(
    acceptanceTransport(envelope(), () => assert.fail("no calls"))(endpoint, {
      method: "POST",
      body: "RAW_SECRET_BAD_JSON",
    }),
    /budget_request_blocked/,
  );
});

test("failures, missing costs and unexpectedly high reported costs cannot trigger another paid call", async () => {
  for (const reply of [
    () => new Response("RAW_SECRET_ERROR", { status: 402 }),
    () => response("{}", null),
    () => response("{}", -1),
    () => response("{}", 0.2),
  ]) {
    let calls = 0;
    const transport = acceptanceTransport(envelope(), async () => {
      calls++;
      return reply();
    });
    await invoke(transport);
    await assert.rejects(
      invoke(transport, "extraction"),
      /budget_request_blocked/,
    );
    assert.equal(calls, 1);
  }
  const broken = acceptanceTransport(envelope(), async () => {
    throw new Error("RAW_SECRET_ERROR");
  });
  await assert.rejects(invoke(broken), /budget_transport_failed/);
  await assert.rejects(invoke(broken), /budget_request_blocked/);
});

test("cancelled and concurrent calls fail before transport; reservations are never recycled", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    acceptanceTransport(envelope(), () => assert.fail("no calls"))(endpoint, {
      method: "POST",
      body: JSON.stringify(request()),
      signal: controller.signal,
    }),
    /run_cancelled/,
  );
  let release;
  let calls = 0;
  const transport = acceptanceTransport(envelope(), () => {
    calls++;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const first = invoke(transport);
  await assert.rejects(invoke(transport), /budget_request_blocked/);
  release(response());
  await first;
  assert.equal(calls, 1);
});

test("real provider, native capture and SQLite compose offline with the guard and private drafts only", async () => {
  const path = await databasePath();
  const f = fixture();
  const bodies = [];
  const provider = new OpenRouterSearchProvider(
    "synthetic-not-a-credential",
    PM_MODEL,
    "medium",
    acceptanceTransport(envelope(), async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1
        ? response(manifest([listing(url)]), 0.001, [url])
        : response(JSON.stringify({ candidates: [f.event] }));
    }),
    PM_MODEL,
    "medium",
  );
  const target = await readCareerTarget();
  const summary = await runIngestion(
    {
      ...options,
      profile: "career",
      search_focus: "product",
      intent: "expand",
      searches: 3,
      career_target: target,
    },
    {
      provider,
      repository: new SqliteIngestionRepository(
        path,
        PM_MODEL,
        "medium",
        PM_MODEL,
        "medium",
      ),
      signal: new AbortController().signal,
      now: () => clock,
      captureSource: (source, retrievalUrl, signal) =>
        captureSourcePage(source, retrievalUrl, signal, {
          now: () => clock,
          resolve: async () => [{ address: "93.184.216.34", family: 4 }],
          request: async () => ({
            status: 200,
            headers: { "content-type": "text/html" },
            body: Buffer.from(f.html),
          }),
        }),
    },
  );
  assert.equal(summary.status, "succeeded", JSON.stringify(summary.errors));
  assert.equal(summary.events_written, 1);
  assert.equal(bodies.length, 2);
  assert.equal(rows(path, "events")[0].publication_status, "draft");
  assert.equal(rows(path, "event_publication_reviews").length, 0);
  await inspectPmDatabase(path);
  assert.equal(rows(path, "events")[0].publication_status, "draft");
  assert.equal(sourceIdentity(url).source_url, url);
});

test("read-only preflight and draft snapshots never initialize storage or copy raw metadata", async () => {
  const dir = await temporaryDirectory();
  await assert.rejects(inspectPmDatabase(join(dir, "missing.sqlite")));
  assert.deepEqual(await readdir(dir), []);
  const path = await databasePath();
  const { summary } = await ingest({ path });
  const before = rows(path, "events");
  const snapshot = snapshotPmRun(path, summary.run_id);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.sources.length, 1);
  assert.equal(snapshot.run.id, summary.run_id);
  assert.equal(snapshot.run.metadata, undefined);
  assert.equal(snapshot.sources[0].raw_payload, undefined);
  assert.deepEqual(rows(path, "events"), before);
  assert.throws(() => snapshotPmRun(path, "invalid"), /invalid_run_id/);
  assert.equal(errorCode(new Error("RAW_SECRET_ERROR")), "unexpected_error");
});
