type Relevance = "direct" | "adjacent" | "none" | null;
type Interaction =
  "networking" | "collaboration" | "qa" | "presentation" | null;
type Quoted<T> = { value: T; quote: string | null };

const PRODUCT_TOPIC =
  /\b(?:product[ -](?:management|discovery|strategy|prioritization|roadmap(?:ping)?|leadership)|customer discovery|user research|for product managers)\b/i;
const DELIVERY_TOPIC =
  /\b(?:project management|program management|technical delivery|software delivery|agile|scrum)\b/i;
const TECHNICAL_TOPIC =
  /\b(?:software|engineering|technical|developers?|cloud|aws|data|databases?|infrastructure|apis?|agentic|artificial intelligence|ai)\b/i;
const BOILERPLATE =
  /\b(?:group chat|chat with (?:other )?attendees before the event|connect with (?:other )?attendees before the event|our (?:group|community)|meetup app|download the app|every (?:week|month)|past events|member benefits)\b/i;
const EVENT_CONTEXT =
  /\b(?:agenda|session|reception|mixer|roundtable|breakout|workshop|event|after the talk|come for|stay for|will|join|includes?)\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i;
const ROLE_CONTEXT =
  /\b(?:agenda|sessions?|workshops?|discussions?|talks?|panels?|demonstrations?|demos?|practice|learn|explore|see (?:exactly )?how|how to|covers?|focus(?:es)?|for career entrants|for product managers)\b/i;
const BIOGRAPHY =
  /\b(?:biography|bio|experience in|years of|worked as|previously|served as)\b/i;

/** Conservative textual gates, not a semantic classifier or factual verification. */
function evidenceClauses(quote: string | null): string[] {
  return (quote ?? "")
    .split(/[.!?;\n]+/)
    .filter((clause) => !BOILERPLATE.test(clause));
}

/** Negation must describe the claimed topic/activity, not incidental requirements. */
function contradicts(clauses: string[], topic: RegExp): boolean {
  const subject = `(?:${topic.source})`;
  const before = new RegExp(
    `\\b(?:no|without|excluding|not(?: (?:a|an|the|about|focused on))?|unrelated to|(?:do not|does not|will not|don't|doesn't|won't)(?: (?:include|offer|provide|feature|cover|discuss))?)\\s+(?:(?:scheduled|planned|advertised|formal|informal|event-specific)\\s+){0,2}${subject}`,
    "gi",
  );
  const after = new RegExp(
    `${subject}(?:\\s+(?:sessions?|workshops?|discussions?|talks?|receptions?|opportunit(?:y|ies)|activit(?:y|ies))){0,2}\\s+(?:(?:is|are|was|were|has been|have been|will be)\\s+)?(?:cancelled|canceled|unavailable|excluded|not (?:planned|scheduled|included|offered|available|provided|permitted)|(?:isn't|aren't|wasn't|weren't) (?:planned|scheduled|included|offered|available|provided|permitted)|(?:will not|won't) (?:happen|occur|be (?:included|offered|available|provided)))\\b`,
    "i",
  );
  return clauses.some((clause) => {
    for (const match of clause.matchAll(before)) {
      const tail = clause.slice(match.index! + match[0].length);
      if (
        !/^\s+(?:experience|knowledge|background|skills|expertise)\s+(?:is\s+)?(?:required|needed|necessary)\b/i.test(
          tail,
        )
      )
        return true;
    }
    return after.test(clause);
  });
}

/** Cap a model's relevance label using only that fact's exact supporting quote. */
export function supportedRelevance(
  fact: Quoted<Relevance>,
  focus: "product" | "delivery",
): Relevance {
  if (fact.value !== "direct" && fact.value !== "adjacent") return fact.value;
  const clauses = evidenceClauses(fact.quote).filter(
    (clause) => ROLE_CONTEXT.test(clause) && !BIOGRAPHY.test(clause),
  );
  const topic = focus === "product" ? PRODUCT_TOPIC : DELIVERY_TOPIC;
  if (contradicts(evidenceClauses(fact.quote), topic)) return null;
  if (clauses.some((clause) => topic.test(clause))) return fact.value;
  return !contradicts(evidenceClauses(fact.quote), TECHNICAL_TOPIC) &&
    clauses.some((clause) => TECHNICAL_TOPIC.test(clause))
    ? "adjacent"
    : null;
}

/** Require an advertised event activity, not a platform feature or a keyword. */
export function supportedInteraction(fact: Quoted<Interaction>): Interaction {
  if (fact.value === null || fact.value === "presentation") return fact.value;
  const activity = {
    networking:
      /\b(?:networking|mixer|meet and greet|small talk|informal conversations?)\b/i,
    collaboration:
      /\b(?:collaborat(?:ion|ive|e)|group exercise|small[ -]group discussion|breakout discussion|pair programming)\b/i,
    qa: /\b(?:q\s*&\s*a|q and a|questions and answers|question[ -]and[ -]answer)\b/i,
  }[fact.value];
  const clauses = evidenceClauses(fact.quote);
  // A quoted contradiction must not be salvaged by another positive sentence.
  if (contradicts(clauses, activity)) return null;
  return clauses.some(
    (clause) => activity.test(clause) && EVENT_CONTEXT.test(clause),
  )
    ? fact.value
    : null;
}
