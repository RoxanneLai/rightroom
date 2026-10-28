import { getSampleEvents } from "../dashboard/sample.ts";
import type { DashboardEvent } from "../dashboard/types.ts";
import { careerAssessmentSchema } from "./contracts.ts";

const DAY_MILLISECONDS = 86_400_000;

function sampleStart(reference: Date, dayOffset: number): string {
  const start = new Date(reference.getTime() + dayOffset * DAY_MILLISECONDS);
  start.setUTCHours(22, 0, 0, 0);
  return start.toISOString();
}

/** Entirely fictional examples; no provider, credential or database access. */
export function getCareerSampleEvents(
  reference = new Date(),
): DashboardEvent[] {
  const base = getSampleEvents()[0];
  return [
    {
      title: "From customer needs to product priorities",
      organizer: "Fictional Product Circle",
      components: {
        role_fit: 30,
        people: 25,
        interaction: 20,
        domain: 15,
        access: 5,
      },
      reasons: [
        "direct_product_fit",
        "relevant_people",
        "networking",
        "preferred_domain",
        "practical_access",
      ],
      cautions: [
        "price_unknown",
        "hiring_unknown",
        "participation_not_guaranteed",
        "registration_unknown",
      ],
      founderAccess: "not_applicable",
    },
    {
      title: "Financial software platforms: a practitioner conversation",
      organizer: "Fictional Capital Markets Lab",
      components: {
        role_fit: 22.5,
        people: 25,
        interaction: 10,
        domain: 15,
        access: 5,
      },
      reasons: [
        "adjacent_product_fit",
        "relevant_people",
        "qa",
        "preferred_domain",
        "practical_access",
      ],
      cautions: [
        "prerequisites",
        "price_unknown",
        "registration_unknown",
        "hiring_unknown",
        "participation_not_guaranteed",
      ],
      founderAccess: "not_applicable",
    },
    {
      title: "Building together: a startup product evening",
      organizer: "Fictional Builder Collective",
      components: {
        role_fit: 22.5,
        people: 25,
        interaction: 20,
        domain: 0,
        access: 0,
      },
      reasons: ["adjacent_product_fit", "relevant_people", "collaboration"],
      cautions: [
        "approval_required",
        "venue_unknown",
        "price_unknown",
        "timezone_inferred_nyc",
        "hiring_unknown",
        "participation_not_guaranteed",
        "registration_unknown",
      ],
      founderAccess: "applicable",
    },
  ].map((example, index) => ({
    ...base,
    id: `career-sample-${index}`,
    title: example.title,
    organizer: example.organizer,
    startsAt: sampleStart(reference, index + 1),
    endsAt: null,
    priceAmountCents: null,
    currencyCode: null,
    recommendation: null,
    founderScore: null,
    investorScore: null,
    networkingScore: null,
    categories: [],
    registrationStatus: "unknown",
    registrationUrl: null,
    source: null,
    neighborhood: null,
    borough: "Manhattan",
    isNew: false,
    venue: index === 2 ? null : "Fictional Midtown workspace",
    potentialDownside: null,
    careerAssessment: careerAssessmentSchema.parse({
      version: "career-score-v1",
      profile_version: "career-v1",
      score: Object.values(example.components).reduce(
        (sum, value) => sum + value,
        0,
      ),
      components: example.components,
      reasons: example.reasons,
      cautions: example.cautions,
      confidence: "needs_checking",
      founderAccess: example.founderAccess,
      hiring: null,
    }),
  }));
}
