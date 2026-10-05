import { mkdir, writeFile } from "node:fs/promises";
import { parseIngestionArgs, INGEST_HELP } from "../lib/ingestion/cli.ts";
import { readIngestionConfig } from "../lib/ingestion/config.ts";
import {
  readModelConfig,
  readOpenRouterKey,
} from "../lib/ingestion/local-config.ts";
import { errorCode } from "../lib/ingestion/errors.ts";
import {
  API_LIMITS,
  createOpenRouterProvider,
} from "../lib/ingestion/openrouter-provider.ts";
import { createConfiguredIngestionRepository } from "../lib/ingestion/repository.ts";
import { runIngestion } from "../lib/ingestion/run.ts";
import { validateLiveSearchWindow } from "../lib/ingestion/options.ts";
import { careerSearchPlan, readCareerTarget } from "../lib/career/profile.ts";
import { captureSourcePage } from "../lib/ingestion/source-capture.ts";
import { SOURCE_CAPTURE_LIMITS } from "../lib/ingestion/source-page.ts";
import { discoveryExclusionPlan } from "../lib/ingestion/exclusions.ts";
import type {
  ReasoningEffort,
  RunSummary,
  SearchOptions,
} from "../lib/ingestion/contracts.ts";

async function saveProgress(summary: RunSummary): Promise<void> {
  await mkdir("codex-tmp", { recursive: true });
  await writeFile(
    "codex-tmp/ingestion-" + summary.run_id + ".json",
    JSON.stringify(summary, null, 2) + "\n",
    { mode: 0o600 },
  );
}

function printPlan(
  options: SearchOptions,
  model: string,
  effort: ReasoningEffort,
  repairModel: string,
  repairEffort: ReasoningEffort,
): void {
  console.log(
    JSON.stringify(
      {
        mode: "plan_only",
        provider: "openrouter-web-search",
        model,
        effort,
        repair: {
          model: repairModel,
          effort: repairEffort,
          maximum_calls: 1,
          tools: false,
        },
        location: "New York City",
        options: {
          ...options,
          intent: options.intent ?? "refresh",
          ...(options.profile === "career"
            ? { search_focus: options.search_focus ?? "balanced" }
            : {}),
        },
        discovery_exclusions: discoveryExclusionPlan(options),
        limits: {
          ...API_LIMITS,
          fetchToolCalls: 0,
          fetchContentTokens: 0,
          searchToolCalls: options.searches ?? 3,
          totalSearchResults: (options.searches ?? 3) * 5,
        },
        evidence: {
          kind: "source_page_text_v1",
          source_capture: SOURCE_CAPTURE_LIMITS,
          extraction_tools: false,
        },
        profile: options.profile ?? "founder",
        planned_queries:
          options.profile === "career" ? careerSearchPlan(options) : [],
        executed_queries: null,
        writes: false,
        paid_calls: false,
        next: "Read docs/INGESTION.md before enabling live mode.",
      },
      null,
      2,
    ),
  );
}

async function executeLive(
  options: SearchOptions,
  model: string,
  effort: ReasoningEffort,
  repairModel: string,
  repairEffort: ReasoningEffort,
): Promise<void> {
  const config = readIngestionConfig(process.env);
  const apiKey = await readOpenRouterKey();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const deadline = setTimeout(cancel, 300000);
  try {
    const summary = await runIngestion(options, {
      provider: createOpenRouterProvider(
        apiKey,
        model,
        effort,
        repairModel,
        repairEffort,
      ),
      repository: createConfiguredIngestionRepository(
        config,
        model,
        effort,
        repairModel,
        repairEffort,
      ),
      signal: controller.signal,
      captureSource: captureSourcePage,
      onProgress: saveProgress,
    });
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = summary.status === "succeeded" ? 0 : 1;
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

async function main(): Promise<void> {
  const args = parseIngestionArgs(process.argv.slice(2));
  if (args.help) {
    console.log(INGEST_HELP);
    return;
  }
  if (args.live) validateLiveSearchWindow(args.options);
  if (args.options.profile === "career")
    args.options.career_target = await readCareerTarget(args.careerConfigPath);
  const settings = await readModelConfig(
    args.configPath,
    args.model,
    args.effort,
    args.repairModel,
    args.repairEffort,
  );
  if (!args.live)
    printPlan(
      args.options,
      settings.model,
      settings.effort,
      settings.repairModel,
      settings.repairEffort,
    );
  else
    await executeLive(
      args.options,
      settings.model,
      settings.effort,
      settings.repairModel,
      settings.repairEffort,
    );
}

main().catch((error: unknown) => {
  console.error(
    "Ingestion stopped: " + errorCode(error) + ". See docs/INGESTION.md.",
  );
  process.exitCode = 1;
});
