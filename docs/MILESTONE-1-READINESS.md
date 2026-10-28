# Milestone 1 readiness audit — October 14, updated October 28, 2026

## Verdict

Milestone 1 is in evidence-building, not complete. The project has a functioning ingestion path, current offline compatibility evidence and a fresh seven-event PM comparison set. It does not yet have the repeated, accessible lead yield required by the PRD exit gate, and the hard paid-discovery budget policy remains unresolved.

The seven-event cohort review and Product Circle native-capture preflight are now complete. The next experiment is prepared, not executed: a credential-free harness creates two source-isolated, same-window plans and evaluates a separately approved completed pair read-only. No comparison result exists yet, so repeatable discovery remains unproven. See [controlled discovery comparison](DISCOVERY-COMPARISON.md).

## Audit boundary

This audit:

- read the imported SQLite history and ignored local checkpoints;
- replayed the three preserved private response captures through current code;
- rechecked the seven public candidate pages and their necessary public corroboration;
- tested whether each candidate URL passes the current source-identity boundary; and
- made no paid request, database write, publication change, registration, payment or host contact.

Aggregate artifacts remain in ignored `codex-tmp/` and contain no private response text:

- `codex-tmp/milestone-1-ingestion-quality.json`
- `codex-tmp/capture-replay-report.json`

The default `data/founder-radar.sqlite` has no evaluable discovery history. The measurements below come from the explicitly selected `data/imported-founder-radar.sqlite`. Running the evaluator without that selection can produce a technically valid but misleading zero-history report.

## Evidence against the exit gate

| Milestone 1 requirement                                         | Current evidence                                                                                                                                                                                                                                     | Status                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Hard-budget policy resolved                                     | The application has a request ceiling, but the approved pilot spending policy is still undecided. Historical provider-reported cost is descriptive, incomplete and not a future budget.                                                              | Not complete                       |
| Direct PM communities and useful technical alternatives checked | Seven current public candidates cover direct PM, product/design, product ownership, CX, research and broad vendor contexts.                                                                                                                          | Complete for this comparison       |
| Original-listing checks                                         | All seven public organizer pages remain active. Lenny and Double Diamond still require secondary date/price corroboration because their readable Luma pages omit those fields.                                                                       | Complete with two explicit caveats |
| Repeatable leads                                                | The latest five terminal runs filled 8 of 15 requested slots and wrote 2 usable drafts. That is useful evidence, but not repeatability across separately authorized fixed windows.                                                                   | Not proven                         |
| Accessible leads                                                | Price and access vary materially: two direct communities require approval, two technical alternatives are just outside the default horizon, one is senior-leader-only, and two exceed the price ceiling. User attendance decisions are still needed. | Not proven                         |
| Failure and miss analysis                                       | Historical funnel, recent cohort, source families, replay limits and source-boundary gaps are documented below.                                                                                                                                      | Complete for current evidence      |

## Historical ingestion evidence

The selected history contains 54 discovery runs, all terminal and summarized. Forty-two ignored checkpoints matched their runs with no invalid or unmatched checkpoint files.

| Measure                              | Full history | Latest five terminal runs |
| ------------------------------------ | -----------: | ------------------------: |
| Requested candidate slots            |          162 |                        15 |
| Sources within the requested limit   |           83 |                         8 |
| Slot fill                            |       51.23% |                    53.33% |
| Usable draft writes                  |           13 |                         2 |
| Write rate per source observation    |       15.66% |                    25.00% |
| Retained links without a write       |           22 |                         2 |
| Observations left unlinked           |           48 |                         4 |
| Diagnostic-covered runs using repair |     11 of 37 |                    0 of 5 |

The recent cohort is more representative of current code than the full history. Its five source-level failure observations comprise two expected past-page rejections, one capture failure and two extraction-or-validation failures. A separate provider failure discovered no source. This points first to discovery recall and focused failure replay, not a general parser rewrite.

Marketplace listings account for 83 of 91 recorded source consultations, or 91.21%. Current historical link rates are 75% for Meetup, 75% for Eventbrite, 50% for the very small first-party/other sample and 11.11% for Luma. These are uncontrolled historical diagnostics across changing implementations, not platform performance comparisons.

Provider diagnostics report 73 requests and $0.78323649 across 35 cost-complete runs, with 13 usable draft writes in those runs. The resulting $0.06024896 per usable write must not be treated as a forecast: provider accounting is unverified, some runs lack complete cost fields, and the implementation changed across the history.

## Offline compatibility replay

All three preserved cases are accepted by the current adapter and produce four events that pass current deterministic validation. The recent five-run cohort also required no repair.

This is reassuring but bounded. Only one replay case contains the exact original failure response; the other two contain later diagnostic responses. The replay therefore disproves a broad claim that all preserved evidence still fails, but it does not prove that every historical parser failure has been fixed. No general parser or repair change is justified without a new reproducible failure.

## Seven-event freshness and access matrix

| Candidate                                                                                   | Public status on October 14                                                  | Price band        | Practical caveat                                            | Current ingestion boundary |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------- | -------------------------- |
| [Lenny's Newsletter October Meetup](https://luma.com/htjlkjr8)                              | Active; October 17 and free remain secondary-corroborated                    | `Yes`             | Approval required; hidden address                           | Accepted Luma identity     |
| [Double Diamond — October 2026](https://luma.com/double-diamond-oct-2026)                   | Active; October 22 and free remain secondary-corroborated                    | `Yes`             | Curated, approval required; hidden address                  | Accepted Luma identity     |
| [PaymentsFn 2026](https://paymentsfn.com/)                                                  | Active; November 18; no fee                                                  | `Yes`             | Limited seats; five days outside default horizon            | Not registered             |
| [Genesys Xperience on Tour](https://www.genesys.com/events/xperience-on-tour-new-york)      | Active; November 17; complimentary for qualifying attendees                  | `Yes` if eligible | CX-leader/vendor context; four days outside default horizon | Not registered             |
| [Experience Research Summit](https://sprig.com/summit/nyc)                                  | Active; November 4; no public price                                          | `Unclassified`    | Application-only, 50 seats, VP/Director/Head audience       | Not registered             |
| [Product Circle Leaders Circle](https://www.productcircle.co/events/new-york-november-2026) | Active; November 13; $579 excluding VAT                                      | `No`              | Application-based; senior product leaders                   | Accepted dated identity    |
| [monday.com Elevate NYC](https://monday.com/elevate/)                                       | Active; October 28–29; official page shows a current $1,200 last-chance tier | `No`              | Broad vendor conference rather than PM-specific             | Not registered             |

No cancellation or stale organizer page was found in this cohort. Freshness is not the same as suitability: Product Circle and Elevate fail the provisional price policy, Sprig has a likely role-access mismatch, and the first four still require a human attendance judgment.

At the October 14 audit, only the two Luma URLs passed the automated source-identity boundary. The [first-party source-readiness follow-up](FIRST-PARTY-SOURCE-READINESS.md) has since enabled only Product Circle's strict dated family after an owner-run native preflight passed; the other four organizer candidates remain unsupported. This narrows the source-coverage gap without proving Product Circle discovery yield or justifying a broad organizer allowlist.

## Recommended sequence

1. Preserve the completed unanchored seven-candidate review and its provisional price bands as human product evidence, not training labels or automatic publication decisions.
2. Keep the existing scoring and parser behavior unchanged unless that review or a new captured failure exposes a narrow, repeatable mismatch.
3. Resolve the paid-discovery spending policy before another paid acceptance attempt. The provisional attendance price bands do not answer the product's API-spending question.
4. Keep Product Circle limited to the enabled dated family and fail closed if future pages do not meet the ordinary capture safeguards.
5. Preserve and replay the next bounded Luma failure before expanding Luma volume or changing its adapter.
6. Use the prepared harness for one no-publication, fixed-window marketplace-versus-Product-Circle comparison. Authorize each paid arm separately, then measure aggregate yield, capture success, usable draft writes, complete provider-reported cost and supplied operator review time.
7. Require at least three separately authorized discovery evaluations to meet the PRD's proposed yield and factual-quality gates before declaring Milestone 1 complete.

## What should not happen next

- Do not call the current 53.33% recent slot fill repeatable discovery.
- Do not infer that all old extraction failures are fixed from one exact original-failure replay.
- Do not treat unknown price as free or relevance as practical access.
- Do not silently expand the 30-day horizon because two useful comparison candidates fall just outside it.
- Do not add accounts, hosting, reminders or broad city support before useful PM discovery and decision quality are demonstrated.
