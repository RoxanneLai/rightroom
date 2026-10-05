import { z } from "zod";
import {
  candidateBaseSchema,
  candidateSchema,
  eventFormatOutputFact,
} from "../ingestion/contracts.ts";

function choice<T extends string>(values: [T, ...T[]]) {
  return z
    .object({
      value: z.enum(values).nullable(),
      quote: z.string().min(1).max(4000).nullable(),
    })
    .strict()
    .refine((fact) => (fact.value === null) === (fact.quote === null));
}
const statedText = z
  .object({
    value: z.string().min(1).max(300).nullable(),
    quote: z.string().min(1).max(4000).nullable(),
  })
  .strict()
  .refine((fact) => (fact.value === null) === (fact.quote === null));
export const careerEvidenceSchema = z
  .object({
    kind: choice(["product", "engineering", "delivery", "community"]),
    product_relevance: choice(["direct", "adjacent", "none"]),
    delivery_relevance: choice(["direct", "adjacent", "none"]),
    domain: statedText,
    eligibility: choice([
      "open",
      "approval_required",
      "waitlist",
      "ineligible",
    ]),
    restrictions: z.array(statedText).max(10),
    prerequisites: z.array(statedText).max(10),
    people: z
      .array(
        z
          .object({
            name: statedText,
            company: statedText,
            role: statedText,
            participation: choice([
              "speaker",
              "host",
              "attendee",
              "sponsor",
              "venue",
            ]),
          })
          .strict(),
      )
      .max(10),
    interaction: choice(["networking", "collaboration", "qa", "presentation"]),
    hiring: choice(["advertised", "not_advertised"]),
    startup_context: choice(["startup", "other"]),
    founders: z
      .array(
        z
          .object({
            name: statedText,
            company: statedText,
            role: choice(["founder", "cofounder"]),
            participation: choice(["speaker", "host", "attendee"]),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

export const careerCandidateSchema = candidateBaseSchema
  .extend({
    relevant_to_founders: z
      .object({ value: z.null(), quote: z.null() })
      .strict(),
    career: careerEvidenceSchema.nullable(),
  })
  .superRefine((candidate, context) => {
    for (const [key, fact] of Object.entries(candidate)) {
      if (
        fact &&
        typeof fact === "object" &&
        "value" in fact &&
        "quote" in fact &&
        ((fact.value === null) !== (fact.quote === null) ||
          (typeof fact.quote === "string" &&
            (!fact.quote.trim() || fact.quote.length > 4000)))
      )
        context.addIssue({
          code: "custom",
          path: [key, "quote"],
          message: "inconsistent fact",
        });
    }
    const rejected = candidate.source_verification.status === "rejected";
    if (
      rejected
        ? candidate.source_verification.reason === null
        : candidate.source_verification.reason !== null
    )
      context.addIssue({
        code: "custom",
        path: ["source_verification", "reason"],
        message: "inconsistent verdict",
      });
    if (rejected) {
      if (
        candidate.career !== null ||
        Object.entries(candidate).some(
          ([key, value]) =>
            !["source_url", "source_verification", "career"].includes(key) &&
            value &&
            typeof value === "object" &&
            "value" in value &&
            (value.value !== null || value.quote !== null),
        )
      )
        context.addIssue({
          code: "custom",
          path: ["source_verification", "status"],
          message: "rejected facts",
        });
    } else if (!candidate.career)
      context.addIssue({
        code: "custom",
        path: ["career"],
        message: "missing career evidence",
      });
  });

export function schemaForProfile(profile?: string): z.ZodType {
  return profile === "career" ? careerCandidateSchema : candidateSchema;
}

/** Restrict gateway format labels without changing historical runtime contracts. */
export function outputSchemaForProfile(profile?: string): z.ZodType {
  const schema = profile === "career" ? careerCandidateSchema : candidateSchema;
  return schema.safeExtend({ event_format: eventFormatOutputFact });
}

export const careerAssessmentSchema = z
  .object({
    version: z.enum(["career-score-v1", "career-score-v2", "career-score-v3"]),
    profile_version: z.string().max(160),
    score: z.number().min(0).max(100),
    components: z
      .object({
        role_fit: z.number().min(0).max(100),
        people: z.number().min(0).max(100),
        interaction: z.number().min(0).max(100),
        domain: z.number().min(0).max(100),
        access: z.number().min(0).max(100),
      })
      .strict(),
    reasons: z
      .array(
        z.enum([
          "direct_product_fit",
          "adjacent_product_fit",
          "direct_delivery_fit",
          "adjacent_delivery_fit",
          "relevant_people",
          "networking",
          "collaboration",
          "qa",
          "preferred_domain",
          "practical_access",
        ]),
      )
      .max(10),
    cautions: z
      .array(
        z.enum([
          "timezone_inferred_nyc",
          "eligibility_unknown",
          "approval_required",
          "waitlist",
          "price_unknown",
          "venue_unknown",
          "registration_unknown",
          "prerequisites",
          "restrictions",
          "hiring_unknown",
          "participation_not_guaranteed",
          "founders_unknown",
          "domain_unknown",
          "interaction_unknown",
          "people_unknown",
          "role_fit_unknown",
          "role_evidence_limited",
          "interaction_evidence_limited",
        ]),
      )
      .max(20),
    confidence: z.enum(["needs_checking", "supported"]),
    founderAccess: z.enum(["applicable", "unknown", "not_applicable"]),
    hiring: z.enum(["advertised", "not_advertised"]).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      Math.abs(
        Object.values(value.components).reduce((sum, item) => sum + item, 0) -
          value.score,
      ) < 0.001,
  );
export type CareerAssessment = z.infer<typeof careerAssessmentSchema>;
