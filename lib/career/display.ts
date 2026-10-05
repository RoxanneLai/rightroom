import type { CareerAssessment } from "./contracts.ts";

type CareerCaution = CareerAssessment["cautions"][number];

const ATTENDANCE_CAUTIONS: readonly CareerCaution[] = [
  "eligibility_unknown",
  "approval_required",
  "waitlist",
  "restrictions",
  "prerequisites",
  "registration_unknown",
  "price_unknown",
  "venue_unknown",
  "timezone_inferred_nyc",
];

/** Group existing public cautions without changing the stored assessment. */
export function groupCareerCautions(cautions: readonly CareerCaution[]): {
  attendance: CareerCaution[];
  evidence: CareerCaution[];
} {
  const unique = new Set(cautions);
  return {
    attendance: ATTENDANCE_CAUTIONS.filter((caution) => unique.has(caution)),
    evidence: [...unique].filter(
      (caution) => !ATTENDANCE_CAUTIONS.includes(caution),
    ),
  };
}

export const CAREER_CAUTION_LABELS: Record<
  CareerAssessment["cautions"][number],
  string
> = {
  timezone_inferred_nyc: "NYC timezone inferred; check the local time",
  eligibility_unknown: "Attendance eligibility not confirmed",
  approval_required: "Attendance requires approval",
  waitlist: "Waitlist; attendance is not confirmed",
  price_unknown: "Admission price not stated",
  venue_unknown: "Exact venue not stated",
  registration_unknown: "Registration availability not stated",
  prerequisites: "Technical prerequisites apply; check the listing",
  restrictions: "Attendance restrictions apply; check the listing",
  hiring_unknown: "Hiring opportunities not stated",
  participation_not_guaranteed: "Advertised participation is not guaranteed",
  founders_unknown: "Startup founder participation not confirmed",
  domain_unknown: "Domain fit not established",
  interaction_unknown:
    "Event-specific conversation opportunities not established",
  people_unknown: "Relevant participants not confirmed",
  role_fit_unknown: "Role fit not established",
  role_evidence_limited: "Role relevance needs checking; score credit limited",
  interaction_evidence_limited:
    "Event-specific conversation evidence unclear; no interaction credit",
};
export const CAREER_REASON_LABELS: Record<
  CareerAssessment["reasons"][number],
  string
> = {
  direct_product_fit: "Direct product-management relevance",
  adjacent_product_fit: "Adjacent product-management relevance",
  direct_delivery_fit: "Direct technical-delivery relevance",
  adjacent_delivery_fit: "Adjacent technical-delivery relevance",
  relevant_people: "Relevant people advertised",
  networking: "Networking opportunities stated",
  collaboration: "Collaborative format stated",
  qa: "Q&A stated; direct conversation is not assured",
  preferred_domain: "Matches a preferred domain",
  practical_access: "Some practical attendance details are supported",
};
