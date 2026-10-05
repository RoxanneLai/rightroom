import type { CareerAssessment } from "@/lib/career/contracts";
import {
  CAREER_CAUTION_LABELS,
  groupCareerCautions,
} from "@/lib/career/display";

export function CareerAttendance({
  assessment,
  eventId,
}: {
  assessment: CareerAssessment;
  eventId: string;
}) {
  const { attendance } = groupCareerCautions(assessment.cautions);
  const headingId = `attendance-${eventId}`;
  return (
    <section className="career-attendance" aria-labelledby={headingId}>
      <h4 id={headingId}>Attendance &amp; eligibility</h4>
      {attendance.length > 0 && (
        <ul className="career-cautions">
          {attendance.map((caution) => (
            <li key={caution}>{CAREER_CAUTION_LABELS[caution]}</li>
          ))}
        </ul>
      )}
      <p>
        Check the listing for current entry requirements and availability.
        Career fit and open registration do not confirm attendance eligibility.
      </p>
    </section>
  );
}
