import assert from "node:assert/strict";
import test from "node:test";
import { careerAssessmentSchema } from "../../lib/career/contracts.ts";
import {
  CAREER_CAUTION_LABELS,
  groupCareerCautions,
} from "../../lib/career/display.ts";

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

test("historical v1-v4 assessments retain scores and cautions after display grouping", () => {
  for (const version of [
    "career-score-v1",
    "career-score-v2",
    "career-score-v3",
    "career-score-v4",
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
