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
  PM_REQUEST_LIMITS,
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
import { errorCode, IngestionError } from "../../lib/ingestion/errors.ts";
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

/** Exercise final-call guard failures through real capture and isolated storage. */
async function guardedRefresh(path, f, replies) {
  let calls = 0;
  const transport = acceptanceTransport(envelope(), async () =>
    replies[calls++](),
  );
  const provider = new OpenRouterSearchProvider(
    "synthetic-not-a-credential",
    PM_MODEL,
    "medium",
    transport,
    PM_MODEL,
    "medium",
  );
  const summary = await runIngestion(
    {
      ...options,
      profile: "career",
      search_focus: "product",
      searches: 3,
      career_target: await readCareerTarget(),
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
  return { summary, calls, transport };
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
        prompt: value.prompt_usd_per_token * 1e6,
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
  for (const [reply, code] of [
    [() => new Response("RAW_SECRET_ERROR", { status: 402 }), null],
    [() => response("{}", null), "budget_cost_unverified"],
    [() => response("{}", -1), "budget_cost_unverified"],
    [() => response("{}", 0.2), "budget_reported_cost_exceeded"],
  ]) {
    let calls = 0;
    const transport = acceptanceTransport(envelope(), async () => {
      calls++;
      return reply();
    });
    if (code)
      await assert.rejects(
        invoke(transport),
        (error) => errorCode(error) === code,
      );
    else assert.equal((await invoke(transport)).status, 402);
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

test("envelopes are deeply frozen and malformed or inconsistent reservations fail before transport", () => {
  const value = envelope();
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.reservations_usd), true);
  assert.throws(() => {
    value.maximum_usd = 0;
  }, TypeError);
  assert.throws(() => {
    value.reservations_usd.research = 0;
  }, TypeError);
  for (const change of [
    (v) => {
      v.maximum_usd = 0.01;
    },
    (v) => {
      v.reservations_usd.research = 0;
    },
    (v) => {
      v.reservations_usd.repair += 0.000001;
    },
    (v) => {
      v.reservations_usd.extra = 0;
    },
    (v) => {
      v.input_usd_per_token = 0;
    },
    (v) => {
      v.context_tokens = 0;
    },
    (v) => {
      v.prompt_usd_per_token = v.input_usd_per_token + 0.1;
    },
    (v) => {
      v.output_usd_per_token = NaN;
    },
    (v) => {
      v.model = "another/model";
    },
    (v) => {
      v.secret = "RAW_SECRET";
    },
    (v) => {
      delete v.reservations_usd;
    },
  ]) {
    const mutated = structuredClone(value);
    change(mutated);
    assert.throws(
      () => acceptanceTransport(mutated, () => assert.fail("no network")),
      /budget_envelope_invalid/,
    );
  }
  const broad = syntheticCatalog();
  broad.context_length = 1_050_000;
  assert.throws(
    () =>
      assertAcceptanceBudget({
        ...acceptanceBudgetEnvelope(broad),
        maximum_usd: 0.01,
      }),
    /budget_envelope_invalid/,
  );
});

test("guard owns a private immutable copy of rates and every phase reservation", async () => {
  const original = envelope();
  const mutable = structuredClone(original);
  const sent = [];
  const transport = acceptanceTransport(mutable, async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return response();
  });
  mutable.maximum_usd = 999;
  mutable.input_usd_per_token = 0.5;
  mutable.prompt_usd_per_token = 0.5;
  mutable.output_usd_per_token = 0.5;
  mutable.reservations_usd.research = 100;
  mutable.reservations_usd.extraction = 100;
  mutable.reservations_usd.repair = 100;
  for (const phase of ["research", "extraction", "repair"])
    await invoke(transport, phase);
  for (const body of sent) {
    assert.equal(
      body.provider.max_price.prompt,
      original.prompt_usd_per_token * 1e6,
    );
    assert.equal(
      body.provider.max_price.completion,
      original.output_usd_per_token * 1e6,
    );
  }
  const second = structuredClone(original);
  const over = acceptanceTransport(second, async () =>
    response("{}", original.reservations_usd.research + 0.001),
  );
  second.reservations_usd.research = 100;
  await assert.rejects(invoke(over), /budget_reported_cost_exceeded/);
});

test("routing caps advertised prompt separately from conservative cache-write input reservations", async () => {
  const model = syntheticCatalog();
  model.pricing.input_cache_write = "0.00000025";
  model.pricing.overrides = [
    { prompt: "0.0000002", input_cache_write: "0.0000003" },
  ];
  const value = acceptanceBudgetEnvelope(model);
  assert.equal(value.prompt_usd_per_token, 0.0000002);
  assert.equal(value.input_usd_per_token, 0.0000005);
  let body;
  await invoke(
    acceptanceTransport(value, async (_url, init) => {
      body = JSON.parse(init.body);
      return response();
    }),
  );
  assert.equal(
    body.provider.max_price.prompt,
    value.prompt_usd_per_token * 1e6,
  );
  assert.ok(body.provider.max_price.prompt < value.input_usd_per_token * 1e6);
  assert.equal(
    body.provider.max_price.completion,
    value.output_usd_per_token * 1e6,
  );
});

test("UTF-8 body and combined message limits apply before transport in every phase without truncation", async () => {
  for (const phase of ["research", "extraction", "repair"]) {
    const limits = PM_REQUEST_LIMITS[phase];
    const bodies = [];
    const transport = acceptanceTransport(envelope(), async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return response();
    });
    for (const earlier of ["research", "extraction", "repair"].slice(
      0,
      ["research", "extraction", "repair"].indexOf(phase),
    ))
      await invoke(transport, earlier);
    const before = bodies.length;
    // Large schema data must also be bounded, not only message content.
    const oversized = request(phase);
    if (phase === "research")
      oversized.messages[1].content = "a".repeat(limits.body_bytes);
    else
      oversized.response_format.json_schema.schema.padding = "a".repeat(
        limits.body_bytes,
      );
    await assert.rejects(
      transport(endpoint, { method: "POST", body: JSON.stringify(oversized) }),
      /budget_input_too_large/,
    );
    const messages = [
      {
        role: "system",
        content: "界".repeat(Math.floor(limits.message_bytes / 6)),
      },
      {
        role: "user",
        content: "界".repeat(Math.floor(limits.message_bytes / 6) + 3),
      },
    ];
    assert.ok(
      messages[0].content.length + messages[1].content.length <
        limits.message_bytes,
    );
    await assert.rejects(
      invoke(transport, phase, { messages }),
      /budget_input_too_large/,
    );
    assert.equal(bodies.length, before);
    const atLimit = [
      { role: "system", content: "s" },
      { role: "user", content: "a".repeat(limits.message_bytes - 1) },
    ];
    await invoke(transport, phase, { messages: atLimit });
    assert.deepEqual(bodies.at(-1).messages, atLimit);
  }
});

test("routing price metadata is included in the wire-body cap", async () => {
  let calls = 0;
  const transport = acceptanceTransport(envelope(), async () => {
    calls++;
    return response();
  });
  await invoke(transport);
  const body = request("extraction");
  body.response_format.json_schema.schema.padding = "";
  const initialBytes = Buffer.byteLength(JSON.stringify(body));
  body.response_format.json_schema.schema.padding = "a".repeat(
    PM_REQUEST_LIMITS.extraction.body_bytes - initialBytes,
  );
  assert.equal(
    Buffer.byteLength(JSON.stringify(body)),
    PM_REQUEST_LIMITS.extraction.body_bytes,
  );
  await assert.rejects(
    transport(endpoint, { method: "POST", body: JSON.stringify(body) }),
    /budget_input_too_large/,
  );
  assert.equal(calls, 1);
});

test("wrong models and malformed successful replies fail immediately with safe codes and no later calls", async () => {
  const good = JSON.parse(await response().text());
  for (const [reply, code] of [
    [
      () =>
        new Response(
          JSON.stringify({ ...good, model: "RAW_SECRET_UNEXPECTED_MODEL" }),
        ),
      "budget_model_mismatch",
    ],
    [
      () => new Response(JSON.stringify({ ...good, model: null })),
      "budget_response_unverified",
    ],
    [() => new Response("RAW_SECRET_NOT_JSON"), "budget_response_unverified"],
    [
      () => new Response("a".repeat(API_LIMITS.responseBytes + 1)),
      "budget_response_unverified",
    ],
    [
      () => new Response(JSON.stringify({ ...good, usage: { cost: "0.001" } })),
      "budget_cost_unverified",
    ],
    [
      () => new Response(JSON.stringify({ ...good, usage: {} })),
      "budget_cost_unverified",
    ],
  ]) {
    let calls = 0;
    const transport = acceptanceTransport(envelope(), async () => {
      calls++;
      return reply();
    });
    await assert.rejects(
      invoke(transport),
      (error) =>
        errorCode(error) === code && !error.message.includes("RAW_SECRET"),
    );
    await assert.rejects(
      invoke(transport, "extraction"),
      /budget_request_blocked/,
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    invoke(
      acceptanceTransport(envelope(), async () => {
        throw new IngestionError("RAW_SECRET_ERROR");
      }),
    ),
    /budget_transport_failed/,
  );
});

test("exact phase reservations and reported zero cost are accepted without releasing later reservations", async () => {
  const value = envelope();
  let index = 0;
  const transport = acceptanceTransport(value, async () =>
    response("{}", Object.values(value.reservations_usd)[index++]),
  );
  for (const phase of ["research", "extraction", "repair"])
    assert.equal((await invoke(transport, phase)).status, 200);
  await assert.rejects(invoke(transport, "repair"), /budget_request_blocked/);
  assert.equal(
    (await invoke(acceptanceTransport(value, async () => response("{}", 0))))
      .status,
    200,
  );
});

test("whole-attempt microdollar sums retain the exact ceiling and reject a genuinely over-budget envelope", () => {
  for (const [price, permitted] of [
    ["0.0214998", true],
    ["0.0215", true],
    ["0.0215002", false],
  ]) {
    const model = syntheticCatalog();
    model.context_length = 1;
    model.pricing = { prompt: price, completion: "0" };
    const value = acceptanceBudgetEnvelope(model);
    const sum =
      Object.values(value.reservations_usd).reduce(
        (total, dollars) => total + Math.round(dollars * 1e6),
        0,
      ) / 1e6;
    assert.equal(value.maximum_usd, sum);
    if (permitted) {
      assert.equal(value.maximum_usd, 0.15);
      assertAcceptanceBudget(value);
    } else
      assert.throws(
        () => assertAcceptanceBudget(value),
        /acceptance_budget_exceeded/,
      );
  }
});

test("HTTP-200 gateway error envelopes keep safe authentication, access and quota codes", async () => {
  for (const [status, code] of [
    [401, "provider_authentication_failed"],
    [403, "provider_access_denied"],
    [402, "provider_quota_or_rate_limit"],
    [429, "provider_quota_or_rate_limit"],
    [500, "provider_request_failed"],
  ]) {
    let calls = 0;
    const transport = acceptanceTransport(envelope(), async () => {
      calls++;
      return new Response(
        JSON.stringify({
          error: { code: status, message: "RAW_SECRET_ERROR" },
        }),
      );
    });
    await assert.rejects(
      invoke(transport),
      (error) => errorCode(error) === code && error.message === code,
    );
    await assert.rejects(
      invoke(transport, "extraction"),
      /budget_request_blocked/,
    );
    assert.equal(calls, 1);
  }
});

test("final extraction and repair budget failures surface safe run errors and preserve successful stored evidence", async () => {
  const f = fixture();
  const canonical = JSON.stringify({ candidates: [f.event] });
  const mismatched = JSON.parse(await response(canonical).text());
  mismatched.model = "vendor/unexpected";
  for (const [lastReply, code, repair] of [
    [
      () => new Response(JSON.stringify(mismatched)),
      "budget_model_mismatch",
      false,
    ],
    [() => response(canonical, null), "budget_cost_unverified", false],
    [() => response(canonical, 0.2), "budget_reported_cost_exceeded", false],
    [() => response(canonical, null), "budget_cost_unverified", true],
    [
      () => new Response(JSON.stringify(mismatched)),
      "budget_model_mismatch",
      true,
    ],
  ]) {
    const path = await databasePath();
    const initial = await ingest({ path, fixtures: [f] });
    assert.equal(initial.summary.events_written, 1);
    const before = rows(path, "events");
    const evidence = rows(path, "event_sources")[0].content_text;
    const replies = [() => response(manifest([listing(url)]), 0.001, [url])];
    if (repair)
      replies.push(() => response(JSON.stringify({ events: [f.event] })));
    replies.push(lastReply);
    const { summary, calls, transport } = await guardedRefresh(
      path,
      f,
      replies,
    );
    assert.equal(summary.status, "partial");
    assert.deepEqual(summary.errors, [code]);
    assert.equal(summary.events_written, 0);
    assert.equal(calls, repair ? 3 : 2);
    await assert.rejects(invoke(transport, "repair"), /budget_request_blocked/);
    assert.deepEqual(rows(path, "events"), before);
    assert.equal(rows(path, "event_sources")[0].content_text, evidence);
    assert.equal(rows(path, "event_sources")[0].last_attempt_error, code);
    assert.equal(rows(path, "event_publication_reviews").length, 0);
    const storedRun = rows(path, "search_runs").find(
      (run) => run.id === summary.run_id,
    );
    assert.equal(storedRun.status, "partial");
    assert.notEqual(storedRun.completed_at, null);
  }
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
