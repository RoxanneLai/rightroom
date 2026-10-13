import type { CareerAssessment } from "@/lib/career/contracts";
import {
  CAREER_CAUTION_LABELS,
  groupCareerCautions,
} from "@/lib/career/display";
import {
  ATTENDANCE_PRICE_LABELS,
  attendancePriceBand,
} from "@/lib/career/attendance-price";

export function CareerAttendance({
  assessment,
  currencyCode,
  eventId,
  priceAmountCents,
}: {
  assessment: CareerAssessment;
  currencyCode: string | null;
  eventId: string;
  priceAmountCents: number | null;
}) {
  const { attendance } = groupCareerCautions(assessment.cautions);
  const priceBand = attendancePriceBand(priceAmountCents, currencyCode);
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
      {priceBand !== "unknown" && (
        <p className={`career-budget career-budget-${priceBand}`}>
          <strong>Provisional price fit:</strong>{" "}
          {ATTENDANCE_PRICE_LABELS[priceBand]}.
        </p>
      )}
      <p>
        Check the listing for current entry requirements and availability.
        Career fit and open registration do not confirm attendance eligibility.
      </p>
    </section>
  );
}
