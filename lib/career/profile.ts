import { readFile } from "node:fs/promises";
import { z } from "zod";
import { IngestionError } from "../ingestion/errors.ts";
import type { SearchOptions } from "../ingestion/contracts.ts";

const label = z.string().trim().min(1).max(160);
export const careerTargetSchema = z
  .object({
    version: label,
    background: z.string().trim().min(1).max(1000),
    primary_roles: z.array(label).min(1).max(5),
    secondary_roles: z.array(label).min(1).max(5),
    preferred_domains: z.array(label).min(1).max(10),
    weights: z
      .object({
        role_fit: z.number().int().min(0).max(100),
        people: z.number().int().min(0).max(100),
        interaction: z.number().int().min(0).max(100),
        domain: z.number().int().min(0).max(100),
        access: z.number().int().min(0).max(100),
      })
      .strict()
      .refine(
        (weights) =>
          Object.values(weights).reduce((sum, value) => sum + value, 0) === 100,
      ),
  })
  .strict();
export type CareerTarget = z.infer<typeof careerTargetSchema>;

export async function readCareerTarget(
  path = "config/career.json",
): Promise<CareerTarget> {
  try {
    const content = await readFile(path, "utf8");
    if (content.length > 8192) throw new Error();
    return careerTargetSchema.parse(JSON.parse(content));
  } catch {
    throw new IngestionError("invalid_career_config");
  }
}

/** Balanced or PM-only families; planned queries are not observed tool execution. */
export function careerSearchPlan(options: SearchOptions) {
  const families = [
    [
      "product",
      "product discovery prioritization analytics ProductTank Women In Product",
    ],
    [
      "company_technology",
      "public employee engineering talks demos developer tools Datadog Kosli",
    ],
    [
      "financial_technology",
      "FINOS trade lifecycle financial software platforms technology at banks",
    ],
    [
      "delivery",
      "technical program project delivery Agile practitioner discussion PMI",
    ],
    ["product", "B2B AI product management career transition Product School"],
    [
      "company_technology",
      "data observability infrastructure company technology open house",
    ],
    [
      "financial_technology",
      "fintech digital products securities platform implementation",
    ],
    [
      "delivery",
      "cross-team software delivery product engineering collaboration",
    ],
    ["product", "product practitioner networking Supermomos product community"],
    [
      "company_technology",
      "applied AI engineering AICamp public technical talks",
    ],
    [
      "financial_technology",
      "capital markets technology community financial data software",
    ],
    [
      "exploratory_employer",
      "software digital product technology talks non-tech employers NY Tech Alliance Tech:NYC",
    ],
  ];
  const selectedFamilies =
    options.search_focus === "product"
      ? families.filter(([family]) => family === "product")
      : families;
  return selectedFamilies
    .slice(0, options.searches ?? 3)
    .map(([family, topic]) => ({
      family,
      query: `NYC in-person ${topic}; events from ${options.from} until ${options.to}; roles ${(options.career_target?.primary_roles ?? []).join(", ")}`,
    }));
}
