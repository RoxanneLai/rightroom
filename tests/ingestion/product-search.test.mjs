import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  careerSearchPlan,
  readCareerTarget,
} from "../../lib/career/profile.ts";
import { parseIngestionArgs } from "../../lib/ingestion/cli.ts";
import { validateSearchOptions } from "../../lib/ingestion/options.ts";
import { researchInput } from "../../lib/ingestion/prompts.ts";
import { OpenRouterSearchProvider } from "../../lib/ingestion/openrouter-provider.ts";
import { runIngestion } from "../../lib/ingestion/run.ts";
import { SupabaseIngestionRepository } from "../../lib/ingestion/repository.ts";
import { SqliteIngestionRepository } from "../../lib/ingestion/sqlite-repository.ts";
import { executeSqliteInspection } from "../../lib/ingestion/inspection.ts";
import { normalizeCandidate } from "../../lib/ingestion/normalize.ts";
import { sourceIdentity } from "../../lib/ingestion/sources.ts";
import { fixture } from "./offline-acceptance-helpers.mjs";
import { options, fakeProvider, memoryRepository, url } from "./helpers.mjs";

const target = await readCareerTarget();
const career = {
  ...options,
  profile: "career",
  searches: 3,
  career_target: target,
};
const now = new Date("2026-09-01T12:00:00Z");
const nodeFlags = ["--conditions=react-server", "--experimental-strip-types"];

async function directory() {
  await mkdir("codex-tmp", { recursive: true });
  const path = await mkdtemp(resolve("codex-tmp/product-search-"));
  await chmod(path, 0o700);
  return path;
}

/** Block external transports and key reads even if paid opt-in is inherited. */
function runCli(cwd, args) {
  const entry = pathToFileURL(resolve("scripts/ingest.ts")).href;
  const bootstrap = `
    import https from 'node:https'; import http from 'node:http';
    import dns from 'node:dns/promises'; import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const blocked = () => { throw new Error('unexpected external access'); };
    globalThis.fetch = blocked; https.request = blocked; http.request = blocked; dns.lookup = blocked;
    const originalRead = fs.readFile;
    fs.readFile = (path, ...rest) => String(path).endsWith('OPENROUTER.key') ? blocked() : originalRead(path, ...rest);
    syncBuiltinESMExports();
    process.argv = ['node', 'ingest', ...${JSON.stringify(args)}];
    await import(${JSON.stringify(entry)});
  `;
  return spawnSync(
    process.execPath,
    [...nodeFlags, "--input-type=module", "-e", bootstrap],
    {
      cwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        FOUNDER_RADAR_ALLOW_PAID_API: "1",
        DATABASE_BACKEND: "invalid-backend-must-not-be-read",
        SQLITE_DATABASE_PATH: join(cwd, "must-not-create.sqlite"),
      },
      timeout: 10000,
    },
  );
}

test("balanced plans preserve the default interleaved families and historical options", () => {
  assert.equal(parseIngestionArgs([], now).options.search_focus, undefined);
  assert.deepEqual(
    careerSearchPlan(career),
    careerSearchPlan({ ...career, search_focus: "balanced" }),
  );
  assert.deepEqual(
    careerSearchPlan(career).map(({ family }) => family),
    ["product", "company_technology", "financial_technology"],
  );
  assert.equal(careerSearchPlan({ ...career, searches: 12 }).length, 12);
  assert.deepEqual(validateSearchOptions(options), options);
});

test("product focus reuses exactly the three existing product families without changing target or window", () => {
  const snapshot = structuredClone(career);
  const expected = careerSearchPlan({ ...career, searches: 12 }).filter(
    ({ family }) => family === "product",
  );
  for (const searches of [1, 2, 3]) {
    const focused = { ...career, search_focus: "product", searches };
    assert.deepEqual(careerSearchPlan(focused), expected.slice(0, searches));
    const input = JSON.parse(researchInput(focused));
    assert.equal(input.search_focus, "product");
    assert.equal(input.search_budget, searches);
    assert.equal(input.max_candidates, 3);
    assert.deepEqual(input.target, target);
    assert.equal(input.starts_at_gte, career.from);
    assert.equal(input.starts_at_lt, career.to);
  }
  assert.deepEqual(career, snapshot);
});

test("search focus is career-only, strict, and product budgets cannot exceed three", () => {
  for (const search_focus of ["balanced", "product"])
    assert.equal(
      parseIngestionArgs(["--search-focus", search_focus], now).options
        .search_focus,
      search_focus,
    );
  for (const args of [
    ["--search-focus"],
    ["--search-focus", ""],
    ["--search-focus", "pm"],
    ["--search-focus", "Product"],
    ["--search-focus", "product", "--search-focus", "balanced"],
    ["--profile", "founder", "--search-focus", "balanced"],
    ["--profile", "founder", "--search-focus", "product"],
  ])
    assert.throws(() => parseIngestionArgs(args, now), /invalid_cli_arguments/);
  assert.throws(
    () =>
      parseIngestionArgs(["--search-focus", "product", "--searches", "4"], now),
    /invalid_search_options/,
  );
  for (const bad of [
    { ...career, search_focus: "unknown" },
    { ...career, search_focus: "product", searches: 4 },
    { ...options, search_focus: "balanced" },
    { ...options, profile: "founder", search_focus: "product" },
    { ...career, search_focus: "product", unexpected: true },
  ])
    assert.throws(() => validateSearchOptions(bad), /invalid_search_options/);
});

test("product focus leaves normalized facts, scores and ineligible rejection unchanged", () => {
  const candidate = fixture(url, "career");
  const before = structuredClone(candidate.event);
  const source = sourceIdentity(url);
  const balanced = normalizeCandidate(
    candidate.event,
    source,
    candidate.html,
    career,
    now.toISOString(),
  );
  const focused = normalizeCandidate(
    candidate.event,
    source,
    candidate.html,
    { ...career, search_focus: "product" },
    now.toISOString(),
  );
  assert.deepEqual(focused, balanced);
  assert.deepEqual(candidate.event, before);
  const ineligible = structuredClone(candidate.event);
  ineligible.career.eligibility = {
    value: "ineligible",
    quote: "Members only.",
  };
  for (const search_focus of ["balanced", "product"])
    assert.throws(
      () =>
        normalizeCandidate(
          ineligible,
          source,
          candidate.html + " Members only.",
          { ...career, search_focus },
          now.toISOString(),
        ),
      /ineligible_event/,
    );
});

test("focused plan prints effective focus and pinned limits with no key, network or database access", async () => {
  const dir = await directory();
  await mkdir(join(dir, "config"));
  for (const name of ["career.json", "ingestion.json"])
    await writeFile(
      join(dir, "config", name),
      await readFile("config/" + name),
    );
  await mkdir(join(dir, "OPENROUTER.key"));
  const result = runCli(dir, [
    "--search-focus",
    "product",
    "--intent",
    "expand",
    "--searches",
    "3",
    "--limit",
    "3",
    "--from",
    options.from,
    "--to",
    options.to,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.options.search_focus, "product");
  assert.equal(plan.options.intent, "expand");
  assert.equal(plan.planned_queries.length, 3);
  assert.ok(plan.planned_queries.every(({ family }) => family === "product"));
  assert.equal(plan.limits.searchToolCalls, 3);
  assert.equal(plan.limits.calls, 3);
  assert.equal(plan.repair.maximum_calls, 1);
  assert.equal(plan.repair.tools, false);
  assert.equal(plan.evidence.extraction_tools, false);
  assert.equal(plan.executed_queries, null);
  assert.equal(plan.writes, false);
  assert.equal(plan.paid_calls, false);
  assert.equal(plan.discovery_exclusions.total_source_count, null);
  await assert.rejects(stat(join(dir, "must-not-create.sqlite")), {
    code: "ENOENT",
  });
});

test("invalid focused CLI options fail before missing configuration, keys, network or database selection", async () => {
  const dir = await directory();
  for (const args of [
    ["--search-focus", ""],
    ["--search-focus", "product", "--search-focus", "product"],
    ["--profile", "founder", "--search-focus", "product"],
    ["--search-focus", "product", "--searches", "4"],
  ]) {
    const result = runCli(dir, [...args, "--live"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid_cli_arguments|invalid_search_options/);
    assert.doesNotMatch(
      result.stderr,
      /invalid_career_config|unexpected external access|invalid_database_backend|invalid_openrouter_key/,
    );
  }
  await assert.rejects(stat(join(dir, "must-not-create.sqlite")), {
    code: "ENOENT",
  });
});

test("offline gateway research carries product focus and bounded PM-only queries in request and metadata", async () => {
  const provider = new OpenRouterSearchProvider(
    "offline-not-a-key",
    "vendor/offline",
    "medium",
    async (endpoint, init) => {
      assert.equal(endpoint, "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(init.body);
      const input = JSON.parse(body.messages[1].content);
      assert.equal(input.search_focus, "product");
      assert.ok(
        input.planned_queries.every(({ family }) => family === "product"),
      );
      assert.equal(input.planned_queries.length, 3);
      assert.equal(body.tools[0].parameters.max_uses, 3);
      assert.equal(body.tool_choice, "required");
      assert.equal(body.provider.require_parameters, true);
      assert.deepEqual(body.reasoning, { effort: "medium", exclude: true });
      return new Response(
        JSON.stringify({
          id: "gen-offline-product",
          model: "vendor/offline",
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: `Cited lead ${url}\n\n\`\`\`rightroom-discovery-v1\n${JSON.stringify({ version: "rightroom-discovery-v1", listings: [{ source_url: url, disposition: "needs_verification" }] })}\n\`\`\``,
                annotations: [{ type: "url_citation", url_citation: { url } }],
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
            server_tool_use: { web_search_requests: 1 },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );
  const result = await provider.research(
    { ...career, search_focus: "product" },
    new AbortController().signal,
  );
  assert.equal(result.metadata.search_focus, "product");
  assert.deepEqual(
    result.metadata.planned_queries,
    careerSearchPlan({ ...career, search_focus: "product" }),
  );
  assert.equal(result.metadata.executed_queries, null);
});

test("run checkpoints retain effective focus without adding calls or publication", async () => {
  for (const search_focus of [undefined, "balanced", "product"]) {
    const repository = memoryRepository();
    const search = { ...career, ...(search_focus ? { search_focus } : {}) };
    const result = await runIngestion(search, {
      repository,
      provider: fakeProvider([], []),
      signal: new AbortController().signal,
      now: () => now,
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.events_written, 0);
    assert.equal(
      repository.runs[0].metadata.search_focus,
      search_focus ?? "balanced",
    );
    assert.deepEqual(
      repository.runs[0].metadata.planned_queries,
      careerSearchPlan(search),
    );
  }
});

test("SQLite and mocked Supabase persist effective focus in search parameters", async () => {
  const dir = await directory();
  const path = join(dir, "synthetic.sqlite");
  const sqlite = new SqliteIngestionRepository(path);
  const calls = [];
  const client = createClient("http://127.0.0.1:54321", "offline-not-a-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (_input, init) => {
        if (init.method === "GET")
          return new Response(JSON.stringify([]), {
            headers: { "content-type": "application/json" },
          });
        assert.equal(init.method, "POST");
        calls.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({ id: "40000000-0000-4000-8000-000000000001" }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  });
  const supabase = new SupabaseIngestionRepository(client);
  for (const search_focus of [undefined, "product"]) {
    const search = { ...career, ...(search_focus ? { search_focus } : {}) };
    const id = await sqlite.start(search);
    assert.equal(
      executeSqliteInspection(id, path).run.search_parameters.search_focus,
      search_focus ?? "balanced",
    );
    await supabase.start(search);
    assert.equal(
      calls.at(-1).search_parameters.search_focus,
      search_focus ?? "balanced",
    );
  }
});
