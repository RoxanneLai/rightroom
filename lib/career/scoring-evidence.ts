type Relevance = "direct" | "adjacent" | "none" | null;
type Interaction =
  "networking" | "collaboration" | "qa" | "presentation" | null;
type Quoted<T> = { value: T; quote: string | null };

const PRODUCT_TOPIC =
  /\b(?:product[ -](?:management|discovery|strategy|prioritization|roadmap(?:ping)?|leadership)|customer discovery|user research|for product managers)\b/i;
const DELIVERY_TOPIC =
  /\b(?:project management|program management|technical delivery|software delivery|agile|scrum)\b/i;
const TECHNICAL_TOPIC =
  /\b(?:software|engineering|developers?|cloud|aws|data|infrastructure|apis?|agentic|artificial intelligence|ai)\b/i;
const BOILERPLATE =
  /\b(?:group chat|chat with|our (?:group|community)|meetup app|download the app|every (?:week|month)|past events|member benefits)\b/i;
const EVENT_CONTEXT =
  /\b(?:agenda|session|reception|mixer|roundtable|breakout|workshop|event|after the talk|will|join|includes?)\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i;
const ROLE_CONTEXT =
  /\b(?:agenda|sessions?|workshops?|discussions?|talks?|panels?|practice|learn|explore|covers?|focus(?:es)?|for career entrants|for product managers)\b/i;
const BIOGRAPHY =
  /\b(?:biography|bio|experience in|years of|worked as|previously|served as)\b/i;

/** Conservative textual gates, not a semantic classifier or factual verification. */
function positiveClauses(quote: string | null): string[] {
  return (quote ?? "")
    .split(/[.!?;\n]+/)
    .filter(
      (clause) =>
        !BOILERPLATE.test(clause) &&
        !/\b(?:no|not|without|excluding|unrelated|cancelled|canceled)\b/i.test(
          clause,
        ),
    );
}

/** Cap a model's relevance label using only that fact's exact supporting quote. */
export function supportedRelevance(
  fact: Quoted<Relevance>,
  focus: "product" | "delivery",
): Relevance {
  if (fact.value !== "direct" && fact.value !== "adjacent") return fact.value;
  const clauses = positiveClauses(fact.quote).filter(
    (clause) => ROLE_CONTEXT.test(clause) && !BIOGRAPHY.test(clause),
  );
  const topic = focus === "product" ? PRODUCT_TOPIC : DELIVERY_TOPIC;
  if (clauses.some((clause) => topic.test(clause))) return fact.value;
  return clauses.some((clause) => TECHNICAL_TOPIC.test(clause))
    ? "adjacent"
    : null;
}

/** Require an advertised event activity, not a platform feature or a keyword. */
export function supportedInteraction(fact: Quoted<Interaction>): Interaction {
  if (fact.value === null || fact.value === "presentation") return fact.value;
  const activity = {
    networking: /\b(?:networking|mixer|meet and greet)\b/i,
    collaboration:
      /\b(?:collaborat(?:ion|ive|e)|group exercise|small[ -]group discussion|breakout discussion|pair programming)\b/i,
    qa: /\b(?:q\s*&\s*a|q and a|questions and answers|question[ -]and[ -]answer)\b/i,
  }[fact.value];
  const clauses = (fact.quote ?? "").split(/[.!?;\n]+/);
  // A quoted contradiction must not be salvaged by another positive sentence.
  if (
    clauses.some(
      (clause) =>
        activity.test(clause) &&
        /\b(?:no|not|without|cancelled|canceled|unavailable)\b/i.test(clause),
    )
  )
    return null;
  return positiveClauses(fact.quote).some(
    (clause) => activity.test(clause) && EVENT_CONTEXT.test(clause),
  )
    ? fact.value
    : null;
}
