import { careerAssessmentSchema, careerEvidenceSchema } from "./contracts.ts";
import type { CareerAssessment } from "./contracts.ts";
import type { CareerTarget } from "./profile.ts";
import type { EventDraft } from "../ingestion/contracts.ts";
import { IngestionError } from "../ingestion/errors.ts";
import { matchesPreferredDomain } from "./domain.ts";
import {
  supportedInteraction,
  supportedRelevance,
} from "./scoring-evidence.ts";

/** Require exact contiguous quotes for every career fact, scoped to this evidence. */
function checkQuotes(value: unknown, evidence: string): void {
  if (Array.isArray(value)) {
    for (const item of value) checkQuotes(item, evidence);
    return;
  }
  if (!value || typeof value !== "object") return;
  if ("value" in value && "quote" in value) {
    if (
      value.value !== null &&
      (typeof value.quote !== "string" || !evidence.includes(value.quote))
    )
      throw new IngestionError("unsupported_career_evidence");
    return;
  }
  for (const child of Object.values(value)) checkQuotes(child, evidence);
}

function supportedName(fact: {
  value: string | null;
  quote: string | null;
}): boolean {
  return (
    fact.value !== null &&
    fact.quote?.toLowerCase().includes(fact.value.toLowerCase()) === true
  );
}

export function assessCareer(
  input: unknown,
  evidence: string,
  event: EventDraft,
  target: CareerTarget,
): CareerAssessment {
  const career = careerEvidenceSchema.parse(input);
  checkQuotes(career, evidence);
  if (
    !["direct", "adjacent"].includes(career.product_relevance.value ?? "") &&
    !["direct", "adjacent"].includes(career.delivery_relevance.value ?? "")
  )
    throw new IngestionError("irrelevant_event");
  if (
    career.eligibility.value === "ineligible" ||
    event.registration_status === "closed" ||
    event.registration_status === "cancelled"
  )
    throw new IngestionError("ineligible_event");
  const product = supportedRelevance(career.product_relevance, "product");
  const delivery = supportedRelevance(career.delivery_relevance, "delivery");
  const role =
    product === "direct"
      ? 1
      : product === "adjacent"
        ? 0.75
        : delivery === "direct"
          ? 0.5
          : delivery === "adjacent"
            ? 0.25
            : 0;
  const applicableFounders =
    career.startup_context.value === "startup" &&
    career.founders.some(
      (person) =>
        supportedName(person.name) &&
        supportedName(person.company) &&
        /\b(startup|early-stage)\b/i.test(person.company.quote ?? "") &&
        /\b(co-?founder|founder)\b/i.test(person.role.quote ?? "") &&
        person.participation.value !== null &&
        person.name.quote === person.company.quote &&
        person.name.quote === person.role.quote &&
        person.role.quote === person.participation.quote,
    );
  const founderAccess = applicableFounders
    ? "applicable"
    : career.startup_context.value === "other"
      ? "not_applicable"
      : "unknown";
  const relevantPeople = career.people.some(
    (person) =>
      supportedName(person.name) &&
      supportedName(person.company) &&
      person.role.value !== null &&
      supportedName(person.role) &&
      ["speaker", "host", "attendee"].includes(
        person.participation.value ?? "",
      ) &&
      /product|engineer|developer|program|project|software|data|platform|delivery/i.test(
        person.role.value,
      ),
  );
  const interaction = supportedInteraction(career.interaction);
  const domainMatch = matchesPreferredDomain(
    career.domain,
    target.preferred_domains,
  );
  const access =
    (career.eligibility.value === "open" ? 0.25 : 0) +
    (event.venue_name ? 0.25 : 0) +
    (["open", "almost-full"].includes(event.registration_status ?? "")
      ? 0.25
      : 0) +
    (event.price_amount_cents === 0 && event.currency_code ? 0.25 : 0);
  const weights = target.weights;
  const components = {
    role_fit: role * weights.role_fit,
    people: relevantPeople || applicableFounders ? weights.people : 0,
    interaction: ["networking", "collaboration"].includes(interaction ?? "")
      ? weights.interaction
      : interaction === "qa"
        ? weights.interaction / 2
        : 0,
    domain: domainMatch ? weights.domain : 0,
    access: access * weights.access,
  };
  const reasons: CareerAssessment["reasons"] = [];
  if (role)
    reasons.push(
      product === "direct"
        ? "direct_product_fit"
        : product === "adjacent"
          ? "adjacent_product_fit"
          : delivery === "direct"
            ? "direct_delivery_fit"
            : "adjacent_delivery_fit",
    );
  if (components.people) reasons.push("relevant_people");
  if (["networking", "collaboration", "qa"].includes(interaction ?? ""))
    reasons.push(interaction as "networking" | "collaboration" | "qa");
  if (domainMatch) reasons.push("preferred_domain");
  if (access) reasons.push("practical_access");
  const cautions: CareerAssessment["cautions"] = [];
  if (
    product !== career.product_relevance.value ||
    delivery !== career.delivery_relevance.value
  )
    cautions.push("role_evidence_limited");
  if (!role) cautions.push("role_fit_unknown");
  if (interaction !== career.interaction.value)
    cautions.push("interaction_evidence_limited");
  if (
    Array.isArray(event.normalization_notes) &&
    event.normalization_notes.includes("timezone_inferred_nyc")
  )
    cautions.push("timezone_inferred_nyc");
  if (career.eligibility.value === null) cautions.push("eligibility_unknown");
  if (career.eligibility.value === "approval_required")
    cautions.push("approval_required");
  if (
    career.eligibility.value === "waitlist" ||
    event.registration_status === "waitlist"
  )
    cautions.push("waitlist");
  if (career.restrictions.length) cautions.push("restrictions");
  if (career.prerequisites.length) cautions.push("prerequisites");
  if (career.hiring.value === null) cautions.push("hiring_unknown");
  if (event.price_amount_cents == null) cautions.push("price_unknown");
  if (!event.venue_name) cautions.push("venue_unknown");
  if (event.registration_status === "unknown")
    cautions.push("registration_unknown");
  if (career.domain.value === null) cautions.push("domain_unknown");
  if (interaction === null) cautions.push("interaction_unknown");
  if (!relevantPeople && !applicableFounders) cautions.push("people_unknown");
  if (components.people) cautions.push("participation_not_guaranteed");
  if (founderAccess === "unknown") cautions.push("founders_unknown");
  return careerAssessmentSchema.parse({
    version: "career-score-v3",
    profile_version: target.version,
    score: Object.values(components).reduce((sum, value) => sum + value, 0),
    components,
    reasons,
    cautions,
    confidence: cautions.length ? "needs_checking" : "supported",
    founderAccess,
    hiring: career.hiring.value,
  });
}
