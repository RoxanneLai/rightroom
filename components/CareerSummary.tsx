import type { CareerAssessment } from "@/lib/career/contracts";
import {
  CAREER_CAUTION_LABELS,
  CAREER_REASON_LABELS,
  groupCareerCautions,
} from "@/lib/career/display";

export function CareerSummary({
  assessment,
}: {
  assessment: CareerAssessment;
}) {
  const { evidence } = groupCareerCautions(assessment.cautions);
  return (
    <div className="recommendation">
      <h4>Why this room fits</h4>
      <p>
        {assessment.reasons
          .map((reason) => CAREER_REASON_LABELS[reason])
          .join(". ")}
        .
      </p>
      <dl className="career-components">
        {Object.entries(assessment.components).map(([key, value]) => (
          <div key={key}>
            <dt>
              {
                (
                  {
                    role_fit: "Role fit",
                    people: "Relevant people",
                    interaction: "Interaction",
                    domain: "Domain fit",
                    access: "Practical access",
                  } as Record<string, string>
                )[key]
              }
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p>
        Founder access:{" "}
        {assessment.founderAccess === "applicable"
          ? "Named startup founders scheduled to participate"
          : assessment.founderAccess === "unknown"
            ? "Participation unknown"
            : "Not applicable; employee and community connections still count"}
        .
      </p>
      <p>
        {assessment.hiring === "advertised"
          ? "Hiring is advertised; check the listing."
          : assessment.hiring === "not_advertised"
            ? "No hiring advertised in the evidence."
            : "Hiring opportunities are unknown."}
      </p>
      {evidence.length > 0 && (
        <ul className="career-cautions">
          {evidence.map((caution) => (
            <li key={caution}>{CAREER_CAUTION_LABELS[caution]}</li>
          ))}
        </ul>
      )}
      <p className="guide-footnote">
        A ranking hypothesis based on supported details, not a probability of
        getting a job.{" "}
        {assessment.confidence === "needs_checking"
          ? "Some details need checking."
          : "Evidence supports the assessed dimensions."}
      </p>
    </div>
  );
}
