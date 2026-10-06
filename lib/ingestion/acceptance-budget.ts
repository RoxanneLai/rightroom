import "server-only";
import { z } from "zod";
import { API_LIMITS } from "./openrouter-provider.ts";
import { IngestionError } from "./errors.ts";
import { readResponseJson } from "./openrouter-response.ts";
import { ALLOWED_DOMAINS } from "./sources.ts";

export const PM_MODEL = "openai/gpt-5.6-luna";
export const PM_BUDGET_USD = 0.15;
export const EXA_AUTO_SEARCH_USD = 0.007;
const MICROS = 1_000_000;
const money = z.union([z.string().regex(/^\d+(?:\.\d+)?$/), z.number()]);
const prices = z
  .object({
    prompt: money,
    completion: money,
    input_cache_read: money.optional(),
    input_cache_write: money.optional(),
    web_search: money.optional(),
    request: money.optional(),
    overrides: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .strict();
const modelSchema = z.object({
  id: z.literal(PM_MODEL),
  context_length: z.number().int().positive().max(10_000_000),
  supported_parameters: z.array(z.string()),
  reasoning: z.object({ supported_efforts: z.array(z.string()) }),
  pricing: prices,
});

export type AcceptancePhase = "research" | "extraction" | "repair";
export type BudgetEnvelope = {
  model: string;
  context_tokens: number;
  input_usd_per_token: number;
  output_usd_per_token: number;
  maximum_usd: number;
  reservations_usd: Record<AcceptancePhase, number>;
};

/** Round reservations upward; never turn small nonzero costs into zero. */
function microdollars(value: number): number {
  const result = Math.ceil(value * MICROS);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new IngestionError("budget_pricing_unavailable");
  return result;
}

function rate(value: unknown): number {
  const parsed = money.safeParse(value);
  const number = parsed.success ? Number(parsed.data) : NaN;
  if (!Number.isFinite(number) || number < 0 || number > 1)
    throw new IngestionError("budget_pricing_unavailable");
  return number;
}

/** Reserve full contexts, all output allowances and every permitted Exa search.
 * This intentionally does not estimate tokens from characters or past run costs.
 */
export function acceptanceBudgetEnvelope(
  catalogModel: unknown,
): BudgetEnvelope {
  const parsed = modelSchema.safeParse(catalogModel);
  if (!parsed.success) throw new IngestionError("budget_catalog_incompatible");
  const model = parsed.data;
  const required = [
    "tools",
    "tool_choice",
    "response_format",
    "structured_outputs",
    "reasoning",
    "max_tokens",
  ];
  if (
    !required.every((name) => model.supported_parameters.includes(name)) ||
    !model.reasoning.supported_efforts.includes("medium")
  )
    throw new IngestionError("budget_model_incompatible");
  const tiers = [model.pricing, ...(model.pricing.overrides ?? [])];
  let input = 0;
  let output = 0;
  for (const tier of tiers) {
    const allowed = new Set([
      "prompt",
      "completion",
      "input_cache_read",
      "input_cache_write",
      "web_search",
      "request",
      "overrides",
      "min_prompt_tokens",
      "max_prompt_tokens",
    ]);
    if (Object.keys(tier).some((key) => !allowed.has(key)))
      throw new IngestionError("budget_unknown_pricing");
    if (tier.request !== undefined && rate(tier.request) !== 0)
      throw new IngestionError("budget_request_fee_unsupported");
    const prompt = rate(tier.prompt ?? model.pricing.prompt);
    const write = rate(
      tier.input_cache_write ?? model.pricing.input_cache_write ?? 0,
    );
    const read = rate(
      tier.input_cache_read ?? model.pricing.input_cache_read ?? 0,
    );
    // Include a possible cache-write surcharge rather than assuming discounted input.
    input = Math.max(input, prompt + write, read);
    output = Math.max(
      output,
      rate(tier.completion ?? model.pricing.completion),
    );
  }
  const reserve = (passes: number, tokens: number, searches = 0) =>
    microdollars(
      passes * (model.context_length * input + tokens * output) +
        searches * EXA_AUTO_SEARCH_USD,
    ) / MICROS;
  const reservations = {
    research: reserve(4, API_LIMITS.researchOutputTokens, 3),
    extraction: reserve(1, API_LIMITS.extractionOutputTokens),
    repair: reserve(1, API_LIMITS.repairOutputTokens),
  };
  return {
    model: PM_MODEL,
    context_tokens: model.context_length,
    input_usd_per_token: input,
    output_usd_per_token: output,
    reservations_usd: reservations,
    maximum_usd:
      Object.values(reservations).reduce(
        (sum, value) => sum + microdollars(value),
        0,
      ) / MICROS,
  };
}

/** Refuse the complete attempt before a database run or paid request is created. */
export function assertAcceptanceBudget(envelope: BudgetEnvelope): void {
  if (microdollars(envelope.maximum_usd) > microdollars(PM_BUDGET_USD))
    throw new IngestionError("acceptance_budget_exceeded");
}

/** Validate only safe credit fields; the key is never changed by this runner. */
export function assertKeyAccess(value: unknown, requiredUsd: number): void {
  const parsed = z
    .object({
      data: z.object({
        limit: z.number().nonnegative().nullable(),
        limit_remaining: z.number().nullable(),
        limit_reset: z.string().nullable(),
        expires_at: z.string().nullable().optional(),
        is_free_tier: z.boolean(),
      }),
    })
    .safeParse(value);
  if (!parsed.success)
    throw new IngestionError("budget_key_status_unavailable");
  const key = parsed.data.data;
  if (
    key.is_free_tier ||
    (key.expires_at &&
      (!Number.isFinite(Date.parse(key.expires_at)) ||
        Date.parse(key.expires_at) <= Date.now())) ||
    (key.limit !== null &&
      (key.limit_remaining === null || key.limit_remaining < requiredUsd)) ||
    (key.limit === null && key.limit_remaining !== null)
  )
    throw new IngestionError("budget_key_unavailable");
}

/** Parse malformed requests into safe codes without exposing their content. */
function acceptanceRequest(
  body: string,
  phase: AcceptancePhase,
): Record<string, unknown> {
  const fields = {
    model: z.literal(PM_MODEL),
    stream: z.literal(false),
    provider: z
      .object({
        require_parameters: z.literal(true),
        allow_fallbacks: z.literal(false),
      })
      .strict(),
    messages: z.tuple([
      z.object({ role: z.literal("system"), content: z.string() }).strict(),
      z.object({ role: z.literal("user"), content: z.string() }).strict(),
    ]),
    reasoning: z
      .object({ effort: z.literal("medium"), exclude: z.literal(true) })
      .strict(),
    max_tokens: z.literal(
      {
        research: API_LIMITS.researchOutputTokens,
        extraction: API_LIMITS.extractionOutputTokens,
        repair: API_LIMITS.repairOutputTokens,
      }[phase],
    ),
  };
  const parameters = z
    .object({
      engine: z.literal("exa"),
      mode: z.literal("auto"),
      max_uses: z.literal(3),
      max_results: z.literal(5),
      max_total_results: z.literal(15),
      max_characters: z.literal(2000),
      allowed_domains: z
        .array(z.string())
        .refine(
          (domains) =>
            JSON.stringify(domains) === JSON.stringify(ALLOWED_DOMAINS),
        ),
    })
    .strict();
  const schema =
    phase === "research"
      ? z
          .object({
            ...fields,
            tools: z.tuple([
              z
                .object({
                  type: z.literal("openrouter:web_search"),
                  parameters,
                })
                .strict(),
            ]),
            tool_choice: z.literal("required"),
            max_tool_calls: z.literal(3),
          })
          .strict()
      : z
          .object({
            ...fields,
            response_format: z
              .object({
                type: z.literal("json_schema"),
                json_schema: z
                  .object({
                    name: z.string(),
                    strict: z.literal(true),
                    schema: z.record(z.string(), z.unknown()),
                  })
                  .strict(),
              })
              .strict(),
          })
          .strict();
  try {
    return schema.parse(JSON.parse(body));
  } catch {
    throw new IngestionError("budget_request_blocked");
  }
}

/** Costs cannot free reservations; missing or suspicious usage stops later calls. */
async function verifiedResponseCost(
  response: Response,
  reservation: number,
): Promise<boolean> {
  const value = await readResponseJson(
    response.clone(),
    API_LIMITS.responseBytes,
  );
  return z
    .object({
      model: z.literal(PM_MODEL),
      usage: z.object({
        cost: z.number().finite().nonnegative().max(reservation),
      }),
    })
    .safeParse(value).success;
}

/** Guard the existing provider; serialize requests and never retry or switch models. */
export function acceptanceTransport(
  envelope: BudgetEnvelope,
  transport: typeof fetch = fetch,
): typeof fetch {
  assertAcceptanceBudget(envelope);
  let calls = 0;
  let busy = false;
  let stopped = false;
  const phases: AcceptancePhase[] = ["research", "extraction", "repair"];
  return async (input, init) => {
    if (
      busy ||
      stopped ||
      calls >= 3 ||
      input !== "https://openrouter.ai/api/v1/chat/completions" ||
      init?.method !== "POST" ||
      typeof init.body !== "string"
    )
      throw new IngestionError("budget_request_blocked");
    if (init.signal?.aborted) throw new IngestionError("run_cancelled");
    const phase = phases[calls];
    const request = acceptanceRequest(init.body, phase);
    busy = true;
    calls += 1;
    try {
      const response = await transport(input, {
        ...init,
        body: JSON.stringify({
          ...request,
          provider: {
            require_parameters: true,
            allow_fallbacks: false,
            max_price: {
              prompt: envelope.input_usd_per_token * MICROS,
              completion: envelope.output_usd_per_token * MICROS,
              request: 0,
            },
          },
        }),
      });
      if (!response.ok) {
        stopped = true;
        return response;
      }
      if (
        !(await verifiedResponseCost(
          response,
          envelope.reservations_usd[phase],
        ))
      )
        stopped = true;
      return response;
    } catch {
      stopped = true;
      throw new IngestionError("budget_transport_failed");
    } finally {
      busy = false;
    }
  };
}
