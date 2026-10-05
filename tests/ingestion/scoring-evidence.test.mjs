import assert from "node:assert/strict";
import test from "node:test";
import { assessCareer } from "../../lib/career/assessment.ts";
import { careerAssessmentSchema } from "../../lib/career/contracts.ts";
import {
  CAREER_CAUTION_LABELS,
  CAREER_REASON_LABELS,
} from "../../lib/career/display.ts";
import {
  supportedInteraction,
  supportedRelevance,
} from "../../lib/career/scoring-evidence.ts";
import { readCareerTarget } from "../../lib/career/profile.ts";
import { normalizeCandidate } from "../../lib/ingestion/normalize.ts";
import { sourceIdentity } from "../../lib/ingestion/sources.ts";
import {
  CAPTURED_CAREER_EXTRACTION_INSTRUCTIONS,
  CAREER_EXTRACTION_INSTRUCTIONS,
  CAREER_REPAIR_INSTRUCTIONS,
} from "../../lib/career/prompts.ts";
import { candidate, fact, options, report, url } from "./helpers.mjs";

const target = await readCareerTarget();
const event = {
  venue_name: null,
  registration_status: "unknown",
  price_amount_cents: null,
  currency_code: null,
};
function career(productQuote, interactionQuote = null) {
  return {
    kind: fact("engineering", productQuote),
    product_relevance: fact("direct", productQuote),
    delivery_relevance: fact(null),
    domain: fact(null),
    eligibility: fact(null),
    restrictions: [],
    prerequisites: [],
    people: [],
    interaction: fact(interactionQuote ? "networking" : null, interactionQuote),
    hiring: fact(null),
    startup_context: fact("other", productQuote),
    founders: [],
  };
}
function assess(input, extraEvidence = "") {
  const quotes = [
    input.kind.quote,
    input.startup_context.quote,
    input.product_relevance.quote,
    input.delivery_relevance.quote,
    input.interaction.quote,
    extraEvidence,
  ].filter(Boolean);
  return assessCareer(input, quotes.join(" "), event, target);
}

test("technical workshops get adjacent not direct product credit; platform chat earns none", () => {
  const input = career(
    "Hands-on technical workshops on agentic AI modernization on AWS.",
    "Chat with attendees in the group chat for networking.",
  );
  const original = structuredClone(input);
  const result = assess(input);
  assert.equal(result.version, "career-score-v4");
  assert.equal(result.score, 22.5);
  assert.equal(result.components.role_fit, 22.5);
  assert.equal(result.components.interaction, 0);
  assert.deepEqual(result.reasons, ["adjacent_product_fit"]);
  assert.ok(result.cautions.includes("role_evidence_limited"));
  assert.ok(result.cautions.includes("interaction_evidence_limited"));
  assert.equal(result.confidence, "needs_checking");
  assert.deepEqual(input, original);
});

test("direct PM practice and scheduled networking outrank a technical workshop", () => {
  const strong = assess(
    career(
      "Product discovery and prioritization workshop.",
      "Agenda: networking reception at 6 PM.",
    ),
  );
  const weak = assess(career("Cloud infrastructure and software workshop."));
  assert.equal(strong.components.role_fit, 30);
  assert.equal(strong.components.interaction, 20);
  assert.equal(strong.score, 50);
  assert.ok(strong.score > weak.score);
  assert.ok(strong.reasons.includes("direct_product_fit"));
  assert.ok(strong.reasons.includes("networking"));
  assert.ok(!strong.cautions.includes("role_evidence_limited"));
  assert.ok(!strong.cautions.includes("interaction_evidence_limited"));
});

test("role rules distinguish product practice, adjacent engineering and fallback delivery", () => {
  for (const quote of [
    "Product management workshop.",
    "Workshop: product strategy and product roadmapping.",
    "Discussion: user research and customer discovery.",
    "An event for product managers.",
  ])
    assert.equal(
      supportedRelevance(fact("direct", quote), "product"),
      "direct",
    );
  for (const quote of [
    "Software engineering workshop.",
    "AWS cloud workshop.",
    "Talk: artificial intelligence and data infrastructure.",
  ])
    assert.equal(
      supportedRelevance(fact("direct", quote), "product"),
      "adjacent",
    );
  for (const quote of [
    "Technical delivery workshop.",
    "Project management and agile practice.",
    "Program management practice using scrum.",
    "Software delivery workshop.",
  ])
    assert.equal(
      supportedRelevance(fact("direct", quote), "delivery"),
      "direct",
    );
  const input = career("Software engineering workshop.");
  input.product_relevance = fact(null);
  input.delivery_relevance = fact("direct", "Technical delivery workshop.");
  assert.equal(assess(input).components.role_fit, 15);
  input.delivery_relevance = fact("direct", "Software engineering workshop.");
  assert.equal(assess(input).components.role_fit, 7.5);
});

test("keywords, merchandise and unrelated praise cannot establish PM role credit", () => {
  for (const quote of [
    "A new product demo with a giveaway.",
    "Premium products and networking accessories.",
    "Great opportunities for your career.",
    "No product management discussion.",
    "Our community offers product management resources.",
    "Metaproduct management and cloudberry tasting.",
    "Product management.",
    "Speaker biography: twenty years of product management experience in software engineering.",
  ]) {
    const result = assess(career(quote));
    assert.equal(result.components.role_fit, 0, quote);
    assert.ok(result.cautions.includes("role_fit_unknown"));
    assert.ok(result.cautions.includes("role_evidence_limited"));
    assert.ok(!result.reasons.includes("direct_product_fit"));
  }
});

test("scoring never upgrades none, unknown, or an explicitly adjacent model label", () => {
  for (const value of [null, "none", "adjacent"])
    assert.equal(
      supportedRelevance(
        fact(value, "Product management workshop."),
        "product",
      ),
      value,
    );
  assert.equal(supportedInteraction(fact(null)), null);
  assert.equal(
    supportedInteraction(fact("presentation", "Agenda: networking reception.")),
    "presentation",
  );
});

test("networking needs event context and excludes platform features or recurring community copy", () => {
  for (const quote of [
    "Networking.",
    "Chat with attendees before the event for networking.",
    "Our community hosts networking events every month.",
    "Download the app to join networking chats.",
    "Past events included a networking reception.",
    "No networking session is planned.",
    "The networking reception is cancelled.",
  ])
    assert.equal(supportedInteraction(fact("networking", quote)), null, quote);
  for (const quote of [
    "Agenda: networking.",
    "5:00 PM networking reception.",
    "Join networking after the talk.",
    "The event includes a meet and greet.",
  ])
    assert.equal(
      supportedInteraction(fact("networking", quote)),
      "networking",
      quote,
    );
});

test("collaboration and Q&A need their own activities; a talk or solo lab is not enough", () => {
  for (const [value, quote, expected] of [
    ["collaboration", "Hands-on AWS workshop.", null],
    ["collaboration", "Workshop: small-group discussion.", "collaboration"],
    ["collaboration", "Breakout session: group exercise.", "collaboration"],
    ["qa", "The keynote includes Q&A.", "qa"],
    ["qa", "The keynote will be presented by an engineer.", null],
    ["qa", "Q&A.", null],
  ])
    assert.equal(supportedInteraction(fact(value, quote)), expected);
  const input = career("Product management workshop.");
  input.interaction = fact("qa", "The keynote includes Q&A.");
  assert.equal(assess(input).components.interaction, 10);
});

test("a quote containing explicit cancelled/absent activity cannot be rescued by a positive sentence", () => {
  assert.equal(
    supportedInteraction(
      fact(
        "networking",
        "Agenda: networking reception. The networking reception is cancelled.",
      ),
    ),
    null,
  );
});

test("scoring is quote-scoped: other page passages cannot supply missing support", () => {
  const input = career(
    "Career opportunities.",
    "Chat with attendees in our group chat.",
  );
  const result = assess(
    input,
    "Product discovery workshop. Agenda: networking reception.",
  );
  assert.equal(result.components.role_fit, 0);
  assert.equal(result.components.interaction, 0);
  input.product_relevance.quote = "Invented product discovery workshop.";
  assert.throws(
    () => assessCareer(input, "Product discovery workshop.", event, target),
    /unsupported_career_evidence/,
  );
});

test("grounded normalization preserves original labels/quotes and keeps eligibility gates", () => {
  const input = candidate();
  const productQuote = "Cloud infrastructure workshop.";
  const interactionQuote = "Chat with attendees in the group chat.";
  input.relevant_to_founders = fact(null);
  input.career = career(productQuote, interactionQuote);
  const evidence = `${report} ${productQuote} ${interactionQuote}`;
  const original = structuredClone(input);
  const opts = { ...options, profile: "career", career_target: target };
  const normalize = () =>
    normalizeCandidate(
      input,
      sourceIdentity(url),
      evidence,
      opts,
      "2026-09-01T12:00:00Z",
    );
  assert.equal(normalize().career_assessment.score, 25);
  assert.deepEqual(input, original);
  input.career.eligibility = fact("ineligible", productQuote);
  assert.throws(normalize, /ineligible_event/);
  input.career.eligibility = fact(null);
  input.event_format = fact("virtual");
  assert.throws(normalize, /unsupported_event_format/);
});

test("all assessment versions remain readable and new review cautions are safe fixed labels", () => {
  const result = assess(career("Cloud workshop.", "Group chat networking."));
  for (const version of [
    "career-score-v1",
    "career-score-v2",
    "career-score-v3",
    "career-score-v4",
  ])
    assert.equal(
      careerAssessmentSchema.safeParse({ ...result, version }).success,
      true,
    );
  assert.equal(
    careerAssessmentSchema.safeParse({ ...result, version: "career-score-v5" })
      .success,
    false,
  );
  for (const caution of result.cautions)
    assert.ok(CAREER_CAUTION_LABELS[caution]);
  for (const reason of result.reasons) assert.ok(CAREER_REASON_LABELS[reason]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /Cloud workshop|Group chat networking/,
  );
});

test("both extraction paths distinguish PM relevance and event interaction; repair cannot invent evidence", () => {
  for (const instructions of [
    CAPTURED_CAREER_EXTRACTION_INSTRUCTIONS,
    CAREER_EXTRACTION_INSTRUCTIONS,
  ]) {
    assert.match(instructions, /at most adjacent product relevance/);
    assert.match(instructions, /Generic community chats/);
    assert.match(instructions, /specific agenda passage/);
  }
  assert.match(
    CAREER_REPAIR_INSTRUCTIONS,
    /without tools, outside knowledge or new facts/,
  );
  assert.match(CAREER_REPAIR_INSTRUCTIONS, /exact quotes verbatim/);
});

test("ordinary demonstrations and implementation sessions earn only adjacent technical credit", () => {
  for (const quote of [
    'See exactly how to wire a database app into cloud dashboards, so "no idea why it is slow" becomes visibility into database health — no custom queries, no guesswork.',
    "We will explore practical implementation approaches in detailed technical sessions.",
    "Demo: how to connect a software application to a monitoring dashboard.",
    "Full day: morning and afternoon technical sessions with hands-on workshops.",
  ]) {
    assert.equal(
      supportedRelevance(fact("direct", quote), "product"),
      "adjacent",
      quote,
    );
    assert.equal(
      supportedRelevance(fact("direct", quote), "delivery"),
      "adjacent",
      quote,
    );
    assert.equal(
      supportedRelevance(fact("adjacent", quote), "delivery"),
      "adjacent",
      quote,
    );
  }
});

test("unrelated negative phrases do not erase PM or technical agenda evidence", () => {
  for (const quote of [
    "Product discovery workshop: no prior experience required.",
    "Learn product management without buying a course.",
    "Product strategy discussion with no guesswork.",
    "Product discovery workshop: no product management experience required.",
  ])
    assert.equal(
      supportedRelevance(fact("direct", quote), "product"),
      "direct",
      quote,
    );
  for (const quote of [
    "How to deploy cloud software without custom queries.",
    "Technical workshop with no coding prerequisites.",
    "Database demonstration: not a sales pitch.",
  ])
    assert.equal(
      supportedRelevance(fact("direct", quote), "delivery"),
      "adjacent",
      quote,
    );
});

test("direct topic negation and cancelled role sessions still withhold credit", () => {
  for (const quote of [
    "No product management discussion is planned.",
    "This is not a product management workshop.",
    "The product discovery workshop is cancelled.",
    "We do not cover product management in this workshop.",
    "Product discovery discussion. The product discovery discussion isn't offered.",
  ])
    assert.equal(
      supportedRelevance(fact("direct", quote), "product"),
      null,
      quote,
    );
  for (const quote of [
    "Software workshops are cancelled.",
    "Without technical sessions, only a merchandise demo remains.",
    "Technical sessions won't be offered.",
  ])
    assert.equal(
      supportedRelevance(fact("adjacent", quote), "delivery"),
      null,
      quote,
    );
});

test("event invitations to informal conversation count without the literal networking keyword", () => {
  for (const quote of [
    "Come for the talks, stay for refreshments and small talk that sparks your next idea.",
    "Join informal conversations after the talk.",
    "Agenda: informal conversation with practitioners.",
    "Chat with speakers during the event networking reception.",
  ])
    assert.equal(
      supportedInteraction(fact("networking", quote)),
      "networking",
      quote,
    );
  for (const quote of [
    "Small talk.",
    "A talk about small talk techniques.",
    "Chat with other attendees before the event starts for small talk.",
    "Our community offers informal conversation every month.",
    "Download the app for event networking and small talk.",
    "Connect with other attendees before the event starts.",
  ])
    assert.equal(supportedInteraction(fact("networking", quote)), null, quote);
});

test("interaction negation is activity-specific and still handles cancelled or absent agendas", () => {
  for (const quote of [
    "Agenda: networking reception, no prior experience required.",
    "Join networking with no coding prerequisites.",
    "The networking reception includes refreshments but no swag.",
    "No software experience required. Agenda: informal conversations.",
    "Networking session: no networking experience required.",
  ])
    assert.equal(
      supportedInteraction(fact("networking", quote)),
      "networking",
      quote,
    );
  for (const quote of [
    "No informal conversation is planned for this event.",
    "Networking opportunities are not offered.",
    "The networking reception isn't available.",
    "This event will not include networking.",
    "The event won't offer small talk.",
    "Agenda: networking reception. Networking won't be provided.",
  ])
    assert.equal(supportedInteraction(fact("networking", quote)), null, quote);
});

test("Q&A and collaboration retain their weights despite unrelated requirements wording", () => {
  const input = career(
    "Product discovery workshop with no prior experience required.",
  );
  input.interaction = fact(
    "qa",
    "The keynote includes Q&A, no technical background required.",
  );
  assert.equal(assess(input).components.interaction, 10);
  input.interaction = fact(
    "collaboration",
    "Workshop: group exercise with no coding prerequisites.",
  );
  assert.equal(assess(input).components.interaction, 20);
  for (const [value, quote] of [
    ["qa", "Q&A will not be offered after the keynote."],
    ["collaboration", "The workshop won't include group exercise."],
  ])
    assert.equal(supportedInteraction(fact(value, quote)), null);
});

test("technical demonstrations with conversations still rank below equally accessible direct PM practice", () => {
  const interaction = "Come for the talks, stay for small talk.";
  const technical = career(
    "Technical workshop with no custom queries.",
    interaction,
  );
  const original = structuredClone(technical);
  const techAssessment = assess(technical);
  const productAssessment = assess(
    career("Product discovery workshop.", interaction),
  );
  assert.equal(techAssessment.score, 42.5);
  assert.equal(productAssessment.score, 50);
  assert.ok(productAssessment.score > techAssessment.score);
  assert.ok(techAssessment.cautions.includes("role_evidence_limited"));
  assert.ok(!techAssessment.reasons.includes("direct_product_fit"));
  assert.deepEqual(technical, original);
});

test("customer or prototype wording alone cannot invent PM relevance or borrow another quote", () => {
  const input = career(
    "From prototype to production: your side project now has paying customers.",
  );
  assert.equal(assess(input).components.role_fit, 0);
  const result = assess(
    input,
    "Product discovery workshop. Demo: database application deployment.",
  );
  assert.equal(result.components.role_fit, 0);
  for (const value of [null, "none", "adjacent"])
    assert.equal(
      supportedRelevance(fact(value, "Technical workshop."), "product"),
      value,
    );
  input.interaction = fact("networking", "Uncaptured small talk at an event.");
  assert.throws(
    () => assessCareer(input, input.product_relevance.quote, event, target),
    /unsupported_career_evidence/,
  );
});
