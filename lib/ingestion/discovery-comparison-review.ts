import "server-only";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { z } from "zod";
import { careerAssessmentSchema } from "../career/contracts.ts";
import { readDatabaseSelection } from "../storage/config.ts";
import { evaluateComparison } from "./discovery-comparison.ts";
import type { EvaluationOptions } from "./discovery-comparison.ts";
import { sourceIdentity, sourceMatchesScope } from "./sources.ts";

type UnknownRecord = Record<string, unknown>;
type Arm = "marketplace" | "product_circle";
type ReviewCommand =
  | {
      command: "prepare";
      marketplaceRun: string;
      productCircleRun: string;
      outputPath: string;
    }
  | { command: "evaluate"; inputPath: string; outputPath: string }
  | { command: "help" };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_GROUP = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const MAX_PACKET_BYTES = 1024 * 1024;
const PACKET_VERSION = "rightroom-comparison-review-v1";
const RUBRIC_TEXT =
  "Fill every judgment. relevance: yes|maybe|no; access: yes|maybe|no|unknown; price_fit for known USD totals: yes at $0-$150 inclusive, maybe above $150-$250 inclusive, no above $250, and unknown for missing or non-USD prices; evidence_quality: sufficient|limited|conflicting|unavailable; each fact: agree|conflict|unknown; disposition: usable|reject|follow_up; rejection_reason for reject: irrelevant|inaccessible|price|factual_conflict|duplicate|stale_or_cancelled|insufficient_evidence|other; duplicate_group uses one shared lowercase label for the same event across sources; review_minutes is 0..1440. Optional miss category: known_event_missed|source_coverage|capture_failure|extraction_failure|access_or_price|duplicate|other. Notes and miss notes remain private and are omitted from aggregate results.";
const armSchema = z.enum(["marketplace", "product_circle"]);
const factVerdictSchema = z.enum(["agree", "conflict", "unknown"]);
const itemSchema = z
  .object({
    item_id: z.string().regex(/^[a-f0-9]{64}$/),
    arm: armSchema,
    run_id: z.string().uuid(),
    source_id: z.string().uuid().nullable(),
    event_id: z.string().uuid().nullable(),
    source_name: z.string().min(1).max(100),
    source_url: z.string().url().max(2048),
    source_state: z.enum(["linked_draft", "source_only", "missing"]),
    last_error: z
      .string()
      .regex(/^[a-z0-9_]{1,80}$/)
      .nullable(),
    event: z
      .object({
        title: z.string().min(1).max(300),
        organizer: z.string().max(300).nullable(),
        starts_at: z.string(),
        ends_at: z.string().nullable(),
        venue: z.string().max(300).nullable(),
        city: z.string().max(160),
        region: z.string().max(160),
        event_format: z.enum(["in-person", "hybrid", "virtual"]),
        price_amount_cents: z.number().int().nonnegative().nullable(),
        currency_code: z.string().length(3).nullable(),
        registration_status: z.enum([
          "unknown",
          "open",
          "almost-full",
          "waitlist",
          "closed",
          "cancelled",
        ]),
        career_score: z.number().min(0).max(100).nullable(),
        career_cautions: z.array(z.string().regex(/^[a-z_]{1,80}$/)).max(20),
      })
      .strict()
      .nullable(),
  })
  .strict();
const judgmentSchema = z
  .object({
    item_id: z.string().regex(/^[a-f0-9]{64}$/),
    relevance: z.enum(["yes", "maybe", "no"]).nullable(),
    access: z.enum(["yes", "maybe", "no", "unknown"]).nullable(),
    price_fit: z.enum(["yes", "maybe", "no", "unknown"]).nullable(),
    evidence_quality: z
      .enum(["sufficient", "limited", "conflicting", "unavailable"])
      .nullable(),
    facts: z
      .object({
        title: factVerdictSchema.nullable(),
        schedule: factVerdictSchema.nullable(),
        location: factVerdictSchema.nullable(),
        registration_identity: factVerdictSchema.nullable(),
      })
      .strict(),
    duplicate_group: z.string().regex(SAFE_GROUP).nullable(),
    disposition: z.enum(["usable", "reject", "follow_up"]).nullable(),
    rejection_reason: z
      .enum([
        "irrelevant",
        "inaccessible",
        "price",
        "factual_conflict",
        "duplicate",
        "stale_or_cancelled",
        "insufficient_evidence",
        "other",
      ])
      .nullable(),
    review_minutes: z.number().int().min(0).max(1440).nullable(),
    notes: z.string().max(500).nullable(),
  })
  .strict();
const missSchema = z
  .object({
    arm: armSchema,
    category: z.enum([
      "known_event_missed",
      "source_coverage",
      "capture_failure",
      "extraction_failure",
      "access_or_price",
      "duplicate",
      "other",
    ]),
    note: z.string().trim().min(1).max(500),
  })
  .strict();
const packetSchema = z
  .object({
    version: z.literal(PACKET_VERSION),
    privacy: z.literal(
      "PRIVATE OPERATOR ARTIFACT — contains unpublished event and source details.",
    ),
    rubric: z.literal(RUBRIC_TEXT),
    comparison: z
      .object({
        marketplace_run: z.string().uuid(),
        product_circle_run: z.string().uuid(),
        from: z.string(),
        to: z.string(),
      })
      .strict(),
    packet_hash: z.string().regex(/^[a-f0-9]{64}$/),
    items: z.array(itemSchema).max(20),
    judgments: z.array(judgmentSchema).max(20),
    misses: z.array(missSchema).max(40),
  })
  .strict();
type Packet = z.infer<typeof packetSchema>;
type Item = z.infer<typeof itemSchema>;
type Judgment = z.infer<typeof judgmentSchema>;

export const COMPARISON_REVIEW_HELP = `Prepare a private comparison review packet read-only:
  npm run ingest:compare:review -- prepare \\
    --marketplace-run UUID --product-circle-run UUID \\
    [--output codex-tmp/discovery-comparison-review.json]

After filling every judgment, validate and aggregate it read-only:
  npm run ingest:compare:review -- evaluate \\
    --input codex-tmp/discovery-comparison-review.json \\
    [--output codex-tmp/discovery-comparison-review-results.json]

Both commands are SQLite-only, offline and publication-free. The packet is private
and contains unpublished event/source details, but never captured text, raw provider
payloads, prompts or model responses. The result contains aggregate metrics only.`;

export function safeComparisonReviewError(error: unknown): string {
  if (
    error instanceof Error &&
    /^(?:comparison_|invalid_comparison_)[a-z0-9_]{1,80}$/.test(error.message)
  )
    return error.message;
  return "comparison_review_failed";
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safePath(path: string, cwd: string): string {
  const root = resolve(cwd, "codex-tmp");
  const target = resolve(cwd, path);
  const fromRoot = relative(root, target);
  if (
    !target.endsWith(".json") ||
    fromRoot === "" ||
    fromRoot.startsWith("..") ||
    fromRoot.startsWith("/")
  )
    throw new Error("invalid_comparison_review_path");
  return target;
}

function parsedValues(
  args: string[],
  options: Record<string, { type: "string" }>,
) {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      tokens: true,
      options,
    });
    const names = (parsed.tokens ?? [])
      .filter((token) => token.kind === "option")
      .map((token) => token.name);
    if (new Set(names).size !== names.length) throw new Error();
    return parsed.values;
  } catch {
    throw new Error("invalid_comparison_review_arguments");
  }
}

export function parseComparisonReviewOptions(
  args: string[],
  cwd = process.cwd(),
): ReviewCommand {
  if (!args.length || (args.length === 1 && ["--help", "-h"].includes(args[0])))
    return { command: "help" };
  const [command, ...rest] = args;
  if (command === "prepare") {
    const values = parsedValues(rest, {
      "marketplace-run": { type: "string" },
      "product-circle-run": { type: "string" },
      output: { type: "string" },
    });
    const marketplaceRun = values["marketplace-run"];
    const productCircleRun = values["product-circle-run"];
    if (
      typeof marketplaceRun !== "string" ||
      !UUID.test(marketplaceRun) ||
      typeof productCircleRun !== "string" ||
      !UUID.test(productCircleRun) ||
      marketplaceRun === productCircleRun
    )
      throw new Error("invalid_comparison_review_arguments");
    return {
      command,
      marketplaceRun,
      productCircleRun,
      outputPath: safePath(
        typeof values.output === "string"
          ? values.output
          : "codex-tmp/discovery-comparison-review.json",
        cwd,
      ),
    };
  }
  if (command === "evaluate") {
    const values = parsedValues(rest, {
      input: { type: "string" },
      output: { type: "string" },
    });
    if (typeof values.input !== "string")
      throw new Error("invalid_comparison_review_arguments");
    return {
      command,
      inputPath: safePath(values.input, cwd),
      outputPath: safePath(
        typeof values.output === "string"
          ? values.output
          : "codex-tmp/discovery-comparison-review-results.json",
        cwd,
      ),
    };
  }
  throw new Error("invalid_comparison_review_arguments");
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function comparisonOptions(
  marketplaceRun: string,
  productCircleRun: string,
): EvaluationOptions {
  return {
    command: "evaluate",
    marketplaceRun,
    productCircleRun,
    marketplaceReviewMinutes: null,
    productCircleReviewMinutes: null,
    outputPath: "",
  };
}

function safeAssessment(value: unknown): {
  score: number | null;
  cautions: string[];
} {
  const parsed = careerAssessmentSchema.safeParse(parseJson(value));
  return parsed.success
    ? { score: parsed.data.score, cautions: parsed.data.cautions }
    : { score: null, cautions: [] };
}

function eventFields(row: UnknownRecord): Item["event"] {
  if (typeof row.event_id !== "string") return null;
  const assessment = safeAssessment(row.career_assessment);
  return {
    title: String(row.title),
    organizer:
      typeof row.organizer_name === "string" ? row.organizer_name : null,
    starts_at: String(row.starts_at),
    ends_at: typeof row.ends_at === "string" ? row.ends_at : null,
    venue: typeof row.venue_name === "string" ? row.venue_name : null,
    city: String(row.city),
    region: String(row.region),
    event_format: row.event_format as "in-person" | "hybrid" | "virtual",
    price_amount_cents:
      typeof row.price_amount_cents === "number"
        ? row.price_amount_cents
        : null,
    currency_code:
      typeof row.currency_code === "string" ? row.currency_code : null,
    registration_status: row.registration_status as
      "unknown" | "open" | "almost-full" | "waitlist" | "closed" | "cancelled",
    career_score: assessment.score,
    career_cautions: assessment.cautions,
  };
}

function blankJudgment(itemId: string): Judgment {
  return {
    item_id: itemId,
    relevance: null,
    access: null,
    price_fit: null,
    evidence_quality: null,
    facts: {
      title: null,
      schedule: null,
      location: null,
      registration_identity: null,
    },
    duplicate_group: null,
    disposition: null,
    rejection_reason: null,
    review_minutes: null,
    notes: null,
  };
}

function runUrls(database: DatabaseSync, runId: string, arm: Arm): string[] {
  const row = database
    .prepare(
      "select metadata, sources_discovered from search_runs where id = ?",
    )
    .get(runId) as UnknownRecord | undefined;
  const metadata = parseJson(row?.metadata);
  const consulted = isRecord(metadata) ? metadata.consulted_urls : null;
  if (!Array.isArray(consulted)) {
    if (row?.sources_discovered === 0) return [];
    throw new Error("comparison_review_sources_unavailable");
  }
  if (consulted.length > 10)
    throw new Error("comparison_review_sources_unavailable");
  const urls: string[] = [];
  for (const value of consulted) {
    const source = typeof value === "string" ? sourceIdentity(value) : null;
    if (!source || !sourceMatchesScope(source, arm))
      throw new Error("comparison_review_sources_unavailable");
    if (!urls.includes(source.source_url)) urls.push(source.source_url);
  }
  return urls;
}

function sourceRow(database: DatabaseSync, url: string): UnknownRecord | null {
  return (
    (database
      .prepare(
        `select s.id as source_id, s.event_id, s.source_name, s.source_url,
          s.last_attempt_error, e.title, e.organizer_name, e.starts_at, e.ends_at,
          e.venue_name, e.city, e.region, e.event_format, e.price_amount_cents,
          e.currency_code, e.registration_status, e.career_assessment
         from event_sources s left join events e on e.id = s.event_id
         where s.source_url = ? limit 1`,
      )
      .get(url) as UnknownRecord | undefined) ?? null
  );
}

function itemFor(
  database: DatabaseSync,
  arm: Arm,
  runId: string,
  url: string,
): Item {
  const row = sourceRow(database, url);
  const source = sourceIdentity(url)!;
  const itemId = createHash("sha256")
    .update(`${arm}\0${source.source_url}`)
    .digest("hex");
  return itemSchema.parse({
    item_id: itemId,
    arm,
    run_id: runId,
    source_id: typeof row?.source_id === "string" ? row.source_id : null,
    event_id: typeof row?.event_id === "string" ? row.event_id : null,
    source_name: source.source_name,
    source_url: source.source_url,
    source_state: !row
      ? "missing"
      : typeof row.event_id === "string"
        ? "linked_draft"
        : "source_only",
    last_error:
      typeof row?.last_attempt_error === "string"
        ? row.last_attempt_error
        : null,
    event: row ? eventFields(row) : null,
  });
}

function packetCore(
  packet: Pick<Packet, "version" | "rubric" | "comparison" | "items">,
) {
  return {
    version: packet.version,
    rubric: packet.rubric,
    comparison: packet.comparison,
    items: packet.items,
  };
}

function packetHash(
  packet: Pick<Packet, "version" | "rubric" | "comparison" | "items">,
) {
  return createHash("sha256")
    .update(JSON.stringify(packetCore(packet)))
    .digest("hex");
}

export function prepareComparisonReview(
  databasePath: string,
  marketplaceRun: string,
  productCircleRun: string,
): Packet {
  const comparison = evaluateComparison(
    databasePath,
    comparisonOptions(marketplaceRun, productCircleRun),
  );
  const sharedWindow = isRecord(comparison.shared_window)
    ? comparison.shared_window
    : null;
  if (!sharedWindow) throw new Error("comparison_run_mismatch");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const items = (
      [
        ["marketplace", marketplaceRun],
        ["product_circle", productCircleRun],
      ] as const
    ).flatMap(([arm, runId]) =>
      runUrls(database, runId, arm).map((url) =>
        itemFor(database, arm, runId, url),
      ),
    );
    const core = {
      version: PACKET_VERSION,
      rubric: RUBRIC_TEXT,
      comparison: {
        marketplace_run: marketplaceRun,
        product_circle_run: productCircleRun,
        from: String(sharedWindow.from),
        to: String(sharedWindow.to),
      },
      items,
    } as const;
    return packetSchema.parse({
      ...core,
      privacy:
        "PRIVATE OPERATOR ARTIFACT — contains unpublished event and source details.",
      packet_hash: packetHash(core),
      judgments: items.map((item) => blankJudgment(item.item_id)),
      misses: [],
    });
  } finally {
    database.close();
  }
}

function completedJudgment(judgment: Judgment): boolean {
  return (
    judgment.relevance !== null &&
    judgment.access !== null &&
    judgment.price_fit !== null &&
    judgment.evidence_quality !== null &&
    Object.values(judgment.facts).every((value) => value !== null) &&
    judgment.disposition !== null &&
    judgment.review_minutes !== null &&
    (judgment.disposition === "reject") === (judgment.rejection_reason !== null)
  );
}

function verifiedUsable(judgment: Judgment): boolean {
  return (
    judgment.disposition === "usable" &&
    judgment.relevance !== "no" &&
    ["yes", "maybe"].includes(String(judgment.access)) &&
    ["yes", "maybe"].includes(String(judgment.price_fit)) &&
    judgment.evidence_quality === "sufficient" &&
    Object.values(judgment.facts).every((value) => value === "agree")
  );
}

function counts(values: Array<string | null>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values)
    if (value) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function armResults(
  arm: Arm,
  items: Item[],
  judgments: Judgment[],
  misses: z.infer<typeof missSchema>[],
) {
  const ids = new Set(
    items.filter((item) => item.arm === arm).map((item) => item.item_id),
  );
  const selected = judgments.filter((judgment) => ids.has(judgment.item_id));
  const usable = selected.filter(verifiedUsable);
  const unique = new Set(
    usable.map((judgment) => judgment.duplicate_group ?? judgment.item_id),
  );
  return {
    candidates_reviewed: selected.length,
    operator_usable_items: selected.filter(
      (judgment) => judgment.disposition === "usable",
    ).length,
    verified_usable_items: usable.length,
    unique_verified_usable_leads: unique.size,
    factual_conflict_items: selected.filter((judgment) =>
      Object.values(judgment.facts).includes("conflict"),
    ).length,
    follow_up_items: selected.filter(
      (judgment) => judgment.disposition === "follow_up",
    ).length,
    rejection_reasons: counts(
      selected.map((judgment) => judgment.rejection_reason),
    ),
    review_minutes: selected.reduce(
      (sum, judgment) => sum + (judgment.review_minutes ?? 0),
      0,
    ),
    miss_categories: counts(
      misses.filter((miss) => miss.arm === arm).map((miss) => miss.category),
    ),
  };
}

export function evaluateComparisonReview(
  packetValue: unknown,
  expected: Packet,
): UnknownRecord {
  const packet = packetSchema.parse(packetValue);
  if (
    packet.packet_hash !== packetHash(packet) ||
    packet.packet_hash !== expected.packet_hash ||
    JSON.stringify(packetCore(packet)) !== JSON.stringify(packetCore(expected))
  )
    throw new Error("comparison_review_packet_stale");
  const itemIds = new Set(packet.items.map((item) => item.item_id));
  if (
    packet.judgments.length !== packet.items.length ||
    new Set(packet.judgments.map((item) => item.item_id)).size !==
      itemIds.size ||
    packet.judgments.some(
      (judgment) =>
        !itemIds.has(judgment.item_id) || !completedJudgment(judgment),
    )
  )
    throw new Error("comparison_review_incomplete");
  const marketplace = armResults(
    "marketplace",
    packet.items,
    packet.judgments,
    packet.misses,
  );
  const productCircle = armResults(
    "product_circle",
    packet.items,
    packet.judgments,
    packet.misses,
  );
  const allUsable = packet.judgments.filter(verifiedUsable);
  const uniqueAcrossArms = new Set(
    allUsable.map((item) => item.duplicate_group ?? item.item_id),
  ).size;
  const windowDays =
    (Date.parse(packet.comparison.to) - Date.parse(packet.comparison.from)) /
    86400000;
  return {
    mode: "offline_discovery_comparison_review",
    comparison_version: "marketplace-vs-product-circle-v1",
    review_version: PACKET_VERSION,
    shared_window: {
      from: packet.comparison.from,
      to: packet.comparison.to,
      days: windowDays,
    },
    arms: { marketplace, product_circle: productCircle },
    unique_verified_usable_leads_across_arms: uniqueAcrossArms,
    proposed_yield_observation: {
      comparable_fourteen_day_window: windowDays > 0 && windowDays <= 14,
      proposed_unique_leads_per_arm: 2,
      marketplace_meets_count:
        windowDays > 0 &&
        windowDays <= 14 &&
        marketplace.unique_verified_usable_leads >= 2,
      product_circle_meets_count:
        windowDays > 0 &&
        windowDays <= 14 &&
        productCircle.unique_verified_usable_leads >= 2,
      note: "One reviewed pair is one learning observation and cannot satisfy the two-of-three milestone gate.",
    },
    limitations: [
      "Verified usable is a conservative operator classification, not publication approval, attendance, or a career outcome.",
      "Duplicate groups and misses are human-supplied and are not independently inferred.",
      "The aggregate omits private notes, event facts, source identities, and URLs.",
    ],
    safety: {
      network_requests: 0,
      paid_requests: 0,
      database_writes: 0,
      publication_changes: 0,
      private_content_in_result: false,
    },
  };
}

async function ownerWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}

async function readPacket(path: string): Promise<Packet> {
  const file = await readFile(path);
  if (file.length > MAX_PACKET_BYTES)
    throw new Error("comparison_review_too_large");
  try {
    return packetSchema.parse(JSON.parse(file.toString("utf8")) as unknown);
  } catch {
    throw new Error("invalid_comparison_review_packet");
  }
}

export async function runComparisonReviewCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<UnknownRecord> {
  const options = parseComparisonReviewOptions(args, cwd);
  if (options.command === "help") return { help: COMPARISON_REVIEW_HELP };
  const selection = readDatabaseSelection(env, cwd);
  if (selection.backend !== "sqlite")
    throw new Error("comparison_review_requires_sqlite");
  if (options.command === "prepare") {
    const packet = prepareComparisonReview(
      selection.path,
      options.marketplaceRun,
      options.productCircleRun,
    );
    await ownerWrite(options.outputPath, packet);
    return {
      mode: "offline_discovery_comparison_review_prepare",
      packet_path: relative(cwd, options.outputPath),
      item_count: packet.items.length,
      safety: {
        network_requests: 0,
        database_writes: 0,
        publication_changes: 0,
      },
    };
  }
  const packet = await readPacket(options.inputPath);
  const expected = prepareComparisonReview(
    selection.path,
    packet.comparison.marketplace_run,
    packet.comparison.product_circle_run,
  );
  const result = evaluateComparisonReview(packet, expected);
  await ownerWrite(options.outputPath, result);
  return {
    mode: result.mode,
    result_path: relative(cwd, options.outputPath),
    shared_window: result.shared_window,
    arms: result.arms,
    proposed_yield_observation: result.proposed_yield_observation,
    safety: result.safety,
  };
}
