import "server-only";
import { parseArgs } from "node:util";
import { REASONING_EFFORTS } from "./contracts.ts";
import { defaultSearchOptions, validateSearchOptions } from "./options.ts";
import { IngestionError } from "./errors.ts";

export const INGEST_HELP = [
  "RightRoom ingestion (local database only)",
  "",
  "npm run ingest -- [--from ISO_TIMESTAMP] [--to ISO_TIMESTAMP] [--limit 1..10]",
  "                 [--model vendor/model-id] [--effort level] [--config path/to/config.json]",
  "                 [--repair-model vendor/model-id] [--repair-effort level]",
  "                 [--profile founder|career] [--searches 1..12] [--career-config path]",
  "                 [--intent refresh|expand]",
  "                 [--search-focus balanced|product]",
  "Career only: balanced (default) interleaves families; product uses only the three existing PM query families (1..3 searches).",
  "Search focus changes research plans, not eligibility, scoring, or publication rules. Planned queries are not verified execution.",
  "Default intent: refresh. Expand excludes up to 50 known/cancelled source identities, prioritizing cancelled sources.",
  "Expand targets new drafts in the chosen window; failed unlinked leads remain eligible. No extra searches or retries.",
  "Default profile: career, with a 30-day window. Use --profile founder for the legacy 14-day startup search.",
  "Both default to 3 hosted searches. Searches are a budget, not a draft guarantee.",
  "--career-config overrides config/career.json for career discovery, including the default profile.",
  "Default: print a plan only. No network, database writes, or API credentials needed.",
  "Model and effort independently override config/ingestion.json (or --config).",
  "Repair model and effort are independent overrides used only for one tool-free schema repair.",
  "When testing another model, normally supply both --model and --effort.",
  "Effort: none, minimal, low, medium, high, xhigh, or max. No environment overrides.",
  "",
  "Add --live AND set FOUNDER_RADAR_ALLOW_PAID_API=1 to permit paid API calls.",
  "A live --from timestamp may be at most 15 minutes old; resolve the window immediately before running.",
  "Supabase only: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; SQLite needs no database credentials.",
  "Required live credential file: OPENROUTER.key in the working directory; one bare key.",
  "The command does not automatically load any .env files.",
  "Limits: 2 normal API requests plus at most 1 tool-free repair; founder up to 3 hosted searches, career up to 12,",
  "        bounded private HTTPS source capture, tool-free extraction, no retries, 5-minute run deadline.",
  "Use --help to show this message. The end timestamp is exclusive.",
].join("\n");

export function parseIngestionArgs(args: string[], now = new Date()) {
  let values;
  try {
    const parsed = parseArgs({
      args,
      tokens: true,
      strict: true,
      allowPositionals: false,
      options: {
        from: { type: "string" },
        to: { type: "string" },
        limit: { type: "string" },
        model: { type: "string" },
        effort: { type: "string" },
        "repair-model": { type: "string" },
        "repair-effort": { type: "string" },
        config: { type: "string" },
        profile: { type: "string" },
        searches: { type: "string" },
        intent: { type: "string" },
        "search-focus": { type: "string" },
        "career-config": { type: "string" },
        live: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    const names = parsed.tokens
      .filter((token) => token.kind === "option")
      .map((token) => token.name);
    if (new Set(names).size !== names.length)
      throw new Error("duplicate option");
    values = parsed.values;
  } catch {
    throw new IngestionError("invalid_cli_arguments");
  }
  if (values.help) return { help: true as const };
  if (
    values.profile !== undefined &&
    !["career", "founder"].includes(values.profile)
  )
    throw new IngestionError("invalid_cli_arguments");
  const profile = (values.profile ?? "career") as "career" | "founder";
  if (
    values["search-focus"] !== undefined &&
    (profile !== "career" ||
      !["balanced", "product"].includes(values["search-focus"]))
  )
    throw new IngestionError("invalid_cli_arguments");
  if (
    values.intent !== undefined &&
    !["refresh", "expand"].includes(values.intent)
  )
    throw new IngestionError("invalid_cli_arguments");
  if (
    values["career-config"] === "" ||
    (values["career-config"] !== undefined && profile !== "career")
  )
    throw new IngestionError("invalid_cli_arguments");
  if (
    values.searches !== undefined &&
    !/^(?:[1-9]|1[0-2])$/.test(values.searches)
  )
    throw new IngestionError("invalid_cli_arguments");
  if (
    values.model === "" ||
    values.effort === "" ||
    values["repair-model"] === "" ||
    values["repair-effort"] === "" ||
    values.config === ""
  )
    throw new IngestionError("invalid_cli_arguments");
  if (
    values.effort !== undefined &&
    !REASONING_EFFORTS.includes(
      values.effort as (typeof REASONING_EFFORTS)[number],
    )
  )
    throw new IngestionError("invalid_cli_arguments");
  if (
    values["repair-effort"] !== undefined &&
    !REASONING_EFFORTS.includes(
      values["repair-effort"] as (typeof REASONING_EFFORTS)[number],
    )
  )
    throw new IngestionError("invalid_cli_arguments");
  const defaults = defaultSearchOptions(now, profile);
  if ((values.from && !values.to) || (!values.from && values.to))
    throw new IngestionError("provide_both_dates");
  if (values.limit !== undefined && !/^\d+$/.test(values.limit))
    throw new IngestionError("invalid_result_limit");
  const options = validateSearchOptions({
    from: values.from ?? defaults.from,
    to: values.to ?? defaults.to,
    limit: values.limit === undefined ? defaults.limit : Number(values.limit),
    profile,
    ...(values.intent ? { intent: values.intent } : {}),
    ...(values["search-focus"]
      ? { search_focus: values["search-focus"] as "balanced" | "product" }
      : {}),
    ...(values.searches ? { searches: Number(values.searches) } : {}),
  });
  return {
    help: false as const,
    live: values.live === true,
    options,
    model: values.model,
    effort: values.effort,
    repairModel: values["repair-model"],
    repairEffort: values["repair-effort"],
    configPath: values.config,
    careerConfigPath: values["career-config"],
  };
}
