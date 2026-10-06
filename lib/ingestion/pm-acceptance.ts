import "server-only";
import { chmod, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { readCareerTarget, careerSearchPlan } from "../career/profile.ts";
import { readDatabaseSelection } from "../storage/config.ts";
import { parseIngestionArgs } from "./cli.ts";
import { readModelConfig, readOpenRouterKey } from "./local-config.ts";
import { IngestionError, errorCode } from "./errors.ts";
import { OpenRouterSearchProvider } from "./openrouter-provider.ts";
import { readResponseJson } from "./openrouter-response.ts";
import { captureSourcePage } from "./source-capture.ts";
import { runIngestion } from "./run.ts";
import { SqliteIngestionRepository } from "./sqlite-repository.ts";
import { validateLiveSearchWindow } from "./options.ts";
import type { RunSummary, SearchOptions } from "./contracts.ts";
import {
  acceptanceBudgetEnvelope,
  assertAcceptanceBudget,
  assertKeyAccess,
  acceptanceTransport,
  PM_MODEL,
  PM_BUDGET_USD,
} from "./acceptance-budget.ts";

export type PmMode = "plan" | "preflight" | "live";

export function parsePmMode(args: string[]): PmMode {
  if (!args.length || (args.length === 1 && args[0] === "--plan"))
    return "plan";
  if (args.length === 1 && args[0] === "--preflight") return "preflight";
  if (args.length === 1 && args[0] === "--live") return "live";
  throw new IngestionError("invalid_pm_acceptance_arguments");
}

/** Pin a fresh window and reuse normal CLI/config validation without secrets. */
export async function preparePmPlan(now = new Date()) {
  const args = parseIngestionArgs(
    [
      "--profile",
      "career",
      "--search-focus",
      "product",
      "--intent",
      "expand",
      "--searches",
      "3",
      "--limit",
      "3",
      "--from",
      now.toISOString(),
      "--to",
      new Date(now.getTime() + 14 * 86400000).toISOString(),
    ],
    now,
  );
  if (args.help) throw new IngestionError("invalid_pm_acceptance_arguments");
  const options = args.options;
  options.career_target = await readCareerTarget();
  await readModelConfig(undefined, PM_MODEL, "medium", PM_MODEL, "medium");
  return {
    mode: "plan_only",
    model: PM_MODEL,
    effort: "medium",
    options,
    repair: {
      model: PM_MODEL,
      effort: "medium",
      maximum_calls: 1,
      tools: false,
    },
    planned_queries: careerSearchPlan(options),
    executed_queries: null,
    ceiling_usd: PM_BUDGET_USD,
    budget_verified: false,
    calls: 3,
    paid_calls: false,
    database_writes: false,
    next: "A free --preflight checks current pricing and local readiness. --live additionally requires paid opt-in; no retries or publication.",
  };
}

/** A GET only: bound responses and never return raw HTTP errors or headers. */
async function safeGet(
  path: string,
  key?: string,
  transport: typeof fetch = fetch,
): Promise<unknown> {
  try {
    const response = await transport("https://openrouter.ai" + path, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      ...(key ? { headers: { Authorization: "Bearer " + key } } : {}),
    });
    if (!response.ok) throw new Error();
    return await readResponseJson(response, 8 * 1024 * 1024);
  } catch {
    throw new IngestionError("pm_access_preflight_failed");
  }
}

/** Compute the whole-attempt reservation before any credential or storage write. */
export async function preflightPmBudget(transport: typeof fetch = fetch) {
  const catalog = await safeGet("/api/v1/models", undefined, transport);
  const parsed = z.object({ data: z.array(z.unknown()) }).safeParse(catalog);
  if (!parsed.success) throw new IngestionError("budget_catalog_unavailable");
  const model = parsed.data.data.find(
    (item) =>
      item && typeof item === "object" && "id" in item && item.id === PM_MODEL,
  );
  const envelope = acceptanceBudgetEnvelope(model);
  return { envelope, within_ceiling: envelope.maximum_usd <= PM_BUDGET_USD };
}

/** Open only existing schema-v2 storage; do not initialize, migrate or rescore it. */
export async function inspectPmDatabase(path: string): Promise<void> {
  if (!(await stat(path)).isFile())
    throw new IngestionError("pm_database_unavailable");
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("pragma query_only = on; pragma busy_timeout = 5000; begin");
    const names = new Set(
      database
        .prepare("select name from sqlite_master where type='table'")
        .all()
        .map(({ name }) => name),
    );
    if (
      Object.values(database.prepare("pragma quick_check").get() ?? {})[0] !==
        "ok" ||
      Object.values(database.prepare("pragma user_version").get() ?? {})[0] !==
        2 ||
      database.prepare("pragma foreign_key_check").all().length !== 0 ||
      ![
        "search_runs",
        "events",
        "event_sources",
        "event_publication_reviews",
        "lead_recovery_audits",
      ].every((name) => names.has(name))
    )
      throw new IngestionError("pm_database_preflight_failed");
    database.exec("commit");
  } finally {
    database.close();
  }
}

export async function pmArtifactDirectory(): Promise<string> {
  await mkdir("codex-tmp", { recursive: true });
  const directory = await mkdtemp(resolve("codex-tmp/pm-acceptance-"));
  await chmod(directory, 0o700);
  return directory;
}

export async function savePmArtifact(
  directory: string,
  name: string,
  value: unknown,
): Promise<void> {
  await writeFile(
    join(directory, name),
    JSON.stringify(value, null, 2) + "\n",
    { mode: 0o600 },
  );
}

/** SQLite's backup API includes committed WAL contents, unlike a raw file copy. */
async function backupPmDatabase(
  path: string,
  directory: string,
): Promise<void> {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    await backup(database, join(directory, "before.sqlite"));
  } finally {
    database.close();
  }
  await chmod(join(directory, "before.sqlite"), 0o600);
}

/** Snapshot only consulted sources/events; do not serialize headers or raw model replies. */
export function snapshotPmRun(path: string, runId: string): unknown {
  if (!z.string().uuid().safeParse(runId).success)
    throw new IngestionError("invalid_run_id");
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("pragma query_only = on; pragma busy_timeout = 5000; begin");
    const run = database
      .prepare(
        "select id, provider, status, started_at, completed_at, sources_discovered, sources_created, sources_updated, error_message from search_runs where id = ?",
      )
      .get(runId);
    const sources = database
      .prepare(
        `select s.id, s.source_url, s.source_name, s.event_id, s.content_text, s.last_attempt_at, s.last_attempt_error from event_sources s where s.discovered_by_run_id = ? or s.source_url in
      (select j.value from search_runs r, json_each(r.metadata, '$.consulted_urls') j where r.id = ?) order by s.source_url`,
      )
      .all(runId, runId);
    const events = sources.flatMap((source) =>
      typeof source.event_id === "string"
        ? [
            database
              .prepare(
                `select id, title, organizer_name, starts_at, ends_at, time_zone, venue_name, city, region, country_code,
      event_format, price_amount_cents, currency_code, registration_status, publication_status, is_fixture, public_registration_url, career_assessment
      from events where id = ?`,
              )
              .get(source.event_id),
          ].filter(Boolean)
        : [],
    );
    database.exec("commit");
    return {
      run,
      sources,
      events: [...new Map(events.map((event) => [event?.id, event])).values()],
    };
  } finally {
    database.close();
  }
}

/** Read-only provider access checks follow the cost and database gates. */
async function preflightPmAccess(
  path: string,
  envelope: Awaited<ReturnType<typeof preflightPmBudget>>["envelope"],
  transport: typeof fetch,
): Promise<string> {
  await inspectPmDatabase(path);
  const key = await readOpenRouterKey();
  assertKeyAccess(
    await safeGet("/api/v1/key", key, transport),
    envelope.maximum_usd,
  );
  const visible = z
    .object({ data: z.array(z.unknown()) })
    .safeParse(await safeGet("/api/v1/models/user", key, transport));
  if (!visible.success) throw new IngestionError("budget_catalog_unavailable");
  const model = visible.data.data.find(
    (item) =>
      item && typeof item === "object" && "id" in item && item.id === PM_MODEL,
  );
  const scoped = acceptanceBudgetEnvelope(model);
  if (JSON.stringify(scoped) !== JSON.stringify(envelope))
    throw new IngestionError("budget_catalog_changed");
  return key;
}

/** Reuse ingestion with its normal source capture, validation and publication boundary. */
async function executePmAttempt(
  options: SearchOptions,
  path: string,
  directory: string,
  key: string,
  envelope: Awaited<ReturnType<typeof preflightPmBudget>>["envelope"],
  transport: typeof fetch,
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const deadline = setTimeout(cancel, 300000);
  const provider = new OpenRouterSearchProvider(
    key,
    PM_MODEL,
    "medium",
    acceptanceTransport(envelope, transport),
    PM_MODEL,
    "medium",
  );
  try {
    const summary = await runIngestion(options, {
      provider,
      repository: new SqliteIngestionRepository(
        path,
        PM_MODEL,
        "medium",
        PM_MODEL,
        "medium",
      ),
      signal: controller.signal,
      captureSource: captureSourcePage,
      onProgress: (summary: RunSummary) =>
        savePmArtifact(directory, "progress.json", summary),
    });
    await savePmArtifact(directory, "result.json", summary);
    await savePmArtifact(
      directory,
      "draft-snapshot.json",
      snapshotPmRun(path, summary.run_id),
    );
    return summary;
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

/** Plan stays free. All gates precede a backup, a run record and any paid POST. */
export async function runPmAcceptance(
  args: string[],
  env: NodeJS.ProcessEnv,
  output: (value: unknown) => void = console.log,
  transport: typeof fetch = fetch,
): Promise<void> {
  const mode = parsePmMode(args);
  const plan = await preparePmPlan();
  output(plan);
  if (mode === "plan") return;
  if (mode === "live" && env.FOUNDER_RADAR_ALLOW_PAID_API !== "1")
    throw new IngestionError("paid_api_not_enabled");
  if (!env.SQLITE_DATABASE_PATH?.trim())
    throw new IngestionError("pm_explicit_database_path_required");
  const selection = readDatabaseSelection(env);
  if (selection.backend !== "sqlite")
    throw new IngestionError("pm_acceptance_requires_sqlite");
  const directory = await pmArtifactDirectory();
  await savePmArtifact(directory, "plan.json", plan);
  output({ private_directory: directory });
  try {
    const budget = await preflightPmBudget(transport);
    await savePmArtifact(directory, "budget.json", budget);
    output({ ...budget, ceiling_usd: PM_BUDGET_USD, paid_requests: 0 });
    assertAcceptanceBudget(budget.envelope);
    const key = await preflightPmAccess(
      selection.path,
      budget.envelope,
      transport,
    );
    if (mode === "preflight") {
      output({ preflight_passed: true, paid_requests: 0, database_writes: 0 });
      return;
    }
    validateLiveSearchWindow(plan.options);
    await backupPmDatabase(selection.path, directory);
    const summary = await executePmAttempt(
      plan.options,
      selection.path,
      directory,
      key,
      budget.envelope,
      transport,
    );
    output(summary);
    if (summary.status !== "succeeded") process.exitCode = 1;
  } catch (error) {
    await savePmArtifact(directory, "stopped.json", {
      error: errorCode(error),
      automatic_retries: 0,
      publication: false,
    });
    throw error;
  }
}
