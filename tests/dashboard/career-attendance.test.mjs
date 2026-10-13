import assert from "node:assert/strict";
import test from "node:test";
import { careerAssessmentSchema } from "../../lib/career/contracts.ts";
import {
  CAREER_CAUTION_LABELS,
  groupCareerCautions,
} from "../../lib/career/display.ts";
import {
  ATTENDANCE_PRICE_LABELS,
  attendancePriceBand,
  PILOT_ATTENDANCE_PRICE_SETTINGS,
} from "../../lib/career/attendance-price.ts";

const attendance = [
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

test("attendance cautions prioritize entry uncertainty separately from score evidence", () => {
  const evidence = [
    "role_evidence_limited",
    "interaction_evidence_limited",
    "hiring_unknown",
    "people_unknown",
    "participation_not_guaranteed",
  ];
  assert.deepEqual(
    groupCareerCautions([...evidence, ...attendance.toReversed()]),
    {
      attendance,
      evidence,
    },
  );
});

test("every public caution is retained in exactly one group with a fixed label", () => {
  const codes = Object.keys(CAREER_CAUTION_LABELS);
  const grouped = groupCareerCautions(codes);
  const combined = [...grouped.attendance, ...grouped.evidence];
  assert.deepEqual(combined.toSorted(), codes.toSorted());
  assert.equal(new Set(combined).size, codes.length);
  assert.ok(
    combined.every((code) => typeof CAREER_CAUTION_LABELS[code] === "string"),
  );
});

test("grouping does not mutate frozen cautions or duplicate displayed warnings", () => {
  const original = Object.freeze([
    "hiring_unknown",
    "restrictions",
    "restrictions",
  ]);
  assert.deepEqual(groupCareerCautions(original), {
    attendance: ["restrictions"],
    evidence: ["hiring_unknown"],
  });
  assert.deepEqual(original, [
    "hiring_unknown",
    "restrictions",
    "restrictions",
  ]);
});

test("empty cautions and evidence-only cautions never invent an eligibility verdict", () => {
  assert.deepEqual(groupCareerCautions([]), { attendance: [], evidence: [] });
  assert.deepEqual(
    groupCareerCautions(["domain_unknown", "founders_unknown"]),
    {
      attendance: [],
      evidence: ["domain_unknown", "founders_unknown"],
    },
  );
});

test("v1-v5 assessments retain scores and cautions after display grouping", () => {
  for (const version of [
    "career-score-v1",
    "career-score-v2",
    "career-score-v3",
    "career-score-v4",
    "career-score-v5",
  ]) {
    const assessment = careerAssessmentSchema.parse({
      version,
      profile_version: "synthetic-career",
      score: 25,
      components: {
        role_fit: 22.5,
        people: 0,
        interaction: 0,
        domain: 0,
        access: 2.5,
      },
      reasons: ["adjacent_product_fit"],
      cautions: ["hiring_unknown", "eligibility_unknown", "restrictions"],
      confidence: "needs_checking",
      founderAccess: "not_applicable",
      hiring: null,
    });
    const before = structuredClone(assessment);
    assert.deepEqual(groupCareerCautions(assessment.cautions), {
      attendance: ["eligibility_unknown", "restrictions"],
      evidence: ["hiring_unknown"],
    });
    assert.deepEqual(assessment, before);
  }
});

test("provisional USD price bands use the approved inclusive boundaries", () => {
  for (const [amount, expected] of [
    [0, "yes"],
    [15_000, "yes"],
    [15_001, "maybe"],
    [25_000, "maybe"],
    [25_001, "no"],
  ])
    assert.equal(attendancePriceBand(amount, "USD"), expected);
  assert.deepEqual(PILOT_ATTENDANCE_PRICE_SETTINGS, {
    version: "nyc-pilot-price-v1",
    currency_code: "USD",
    yes_max_cents: 15_000,
    maybe_max_cents: 25_000,
  });
  assert.equal(Object.isFrozen(PILOT_ATTENDANCE_PRICE_SETTINGS), true);
});

test("unknown, malformed and non-USD prices never enter a pilot price band", () => {
  for (const [amount, currency] of [
    [null, "USD"],
    [0, null],
    [10_000, "EUR"],
    [-1, "USD"],
    [1.5, "USD"],
    [Number.NaN, "USD"],
    [Number.POSITIVE_INFINITY, "USD"],
  ])
    assert.equal(attendancePriceBand(amount, currency), "unknown");
});

test("each visible pilot price band has a fixed, nonempty label", () => {
  assert.deepEqual(Object.keys(ATTENDANCE_PRICE_LABELS), [
    "yes",
    "maybe",
    "no",
  ]);
  assert.ok(
    Object.values(ATTENDANCE_PRICE_LABELS).every(
      (label) => typeof label === "string" && label.length > 0,
    ),
  );
});
