# RightRoom Product Requirements

NYC career discovery pilot

**Status:** Working draft. Proposed requirements and thresholds are not approved commitments.

**Planning edition:** October 13, 2026. **Product lead:** Roxanne Lai.

**Implementation reference:** [d1e0946](https://github.com/RoxanneLai/rightroom/tree/d1e0946). This is a dated snapshot. See the [product document guide](README.md) for versioning and the current technical guides.

## Product summary

RightRoom helps job seekers decide which in-person professional events are worth attending. It finds public listings, checks the evidence, explains career fit and attendance uncertainty, and keeps discovered events private until an operator approves publication.

### Proposed release outcome

A hosted NYC pilot for people entering or moving into product management and technical product management. A visitor can find a current, relevant room, understand why it fits, assess access restrictions, save an attendance choice and follow the original registration link. This is the assumed first finished product, subject to product approval.

### Current maturity

The local application and operator workflow are implemented. Small live runs have written drafts, and a reviewed career lead has been explicitly published. The current branch also includes a browser-local attendance shortlist. Repeatable PM coverage, ranking usefulness, a sustainable spending policy and hosted operation remain unproven.

### Scope and decision status

- Implemented means present in the inspected branch, not deployed or validated with a user cohort.
- Proposed requirements, pilot thresholds and roadmap gates below are recommendations, not approved commitments.
- No automatic event publication, registration, outreach or promise of hiring access is in scope.

Evidence baseline: codex/pm-discovery-plan at d1e0946, inspected on October 13. The most recent documented full verification is October 9. No fresh application verification or live inventory audit was performed for this PRD.

## Users and product decisions

### Initial audience

The first segment is NYC job seekers with a technical background who are exploring PM or technical-PM roles. Technical project and program management are secondary opportunities. The current shared target profile reflects a computer-science graduate with capital-markets technology experience. It is configuration, not an account-specific profile or résumé upload.

### Job to be done

When I have limited time for networking, help me choose a local event where relevant conversations are plausible and attendance is practical, so I can decide where to spend an evening without checking many disconnected listings.

### User problem

Event calendars describe what is happening, but relevance and access are harder to judge. A technical subject can fit a career background without providing PM conversation. Host approval, membership, seniority or a company-name requirement can make a relevant event uncertain for an unaffiliated job seeker. These are observed product concerns, not quantified market research.

### End user journey

| Step                 | Decision supported                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Discover             | Browse published upcoming NYC career events. An empty feed and a failed feed are distinct.  |
| Evaluate             | Read source-linked facts, fit components, confidence and attendance cautions.               |
| Choose               | Mark Interested, Maybe or Not for me and filter the current feed.                           |
| Register externally  | Open the original registration route. RightRoom does not submit a form or guarantee access. |
| Reflect in the pilot | Provide optional usefulness and attendance feedback through a proposed research process.    |

### Product choices

Start with NYC and a narrow career segment before adding geography or a general matching platform. Make evidence and unknowns visible rather than presenting a score as certainty. Retain human publication review while model output remains inconsistent. Local-first storage reduces setup friction, while hosted operation requires a separate deployment decision.

## Current system design

The application has a private collection and review path, a public read path, and a browser-only preference layer. The private path can create leads and drafts. It cannot publish an event without a separate explicit approval.

| Layer              | Current responsibility                                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web application    | Next.js 16.3.4 and TypeScript render published career events at / and /career. /events retains the broader published feed. Samples are explicitly fictional.                                                                                                     |
| Discovery service  | A manual CLI sends bounded research through OpenRouter, captures original public pages locally, and requests structured extraction. One conditional repair call is allowed. Primary and repair defaults are Luna with medium effort, independently configurable. |
| Shared validation  | Source identity, quote support, physical NYC attendance, dates, cancellation, relevance and unknown values are checked before draft persistence. Career scoring is deterministic and versioned.                                                                  |
| Storage adapters   | SQLite is the default persistent local database. Supabase/Postgres is explicitly selectable. Shared interfaces cover ingestion, public reads, inspection and publication review.                                                                                 |
| Operator workflow  | CLI queues expose private leads and drafts. Preview tokens bind approval to the reviewed snapshot. Recovery is a separate, explicit SQLite workflow.                                                                                                             |
| Personal shortlist | Browser localStorage saves fixed choices by public event ID. It does not sync to a database, change ranking, register attendance or send analytics.                                                                                                              |

### Event lifecycle and trust boundary

A discovered source is a private lead. An accepted normalized event becomes a private draft. Human approval creates a published event and an approval history entry. Public repositories expose only approved public fields from eligible published, non-fixture events. Source text, research, raw candidates and approval history remain server-side.

### Persistence and identity

Core records are search runs, event sources, events and publication reviews, with separate recovery audit records. Canonical URLs and external IDs deduplicate source identities. Transactions preserve good evidence after a failed refresh and protect reviewed, published and archived events. Semantic matching of the same event across different platforms is not implemented.

Backend selection never transfers data or silently falls back. An explicit Supabase-to-SQLite import preserves relationships and history. SQLite uses foreign keys and local concurrency controls, but hosted use needs persistent storage and a tested operating model.

## Implemented scope and evidence

| Capability              | Evidence and remaining limit                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Career discovery        | Career defaults, diversified query plans and opt-in PM focus exist. Hosted searches are model-directed, not dedicated community crawlers or exhaustive coverage.                |
| Evidence and extraction | Bounded public page capture, strict structured extraction and one fact-preserving repair are implemented. A schema-valid candidate still requires semantic review.              |
| Explainable ranking     | Role fit 30, relevant people 25, interaction 20, domain fit 15 and access 10. Conservative evidence gates are tested. Weights and scores are not calibrated to career outcomes. |
| Review and publication  | Private queues, stale approval protection and approval history exist. There is no browser-based operator inbox or automatic publication.                                        |
| Attendance choices      | Interested, Maybe and Not for me, edition isolation, filtering and storage-failure recovery are implemented. No account, cross-device sync or saved archive exists.             |
| Verification            | 308 deterministic offline tests and 18 production-page/runtime checks were documented as passing on October 9. Tests prove software behavior, not live discovery quality.       |

### What we have learned

The October 5 expansion checkpoint produced one new private draft in 31.086 seconds without repair. Two model requests reported $0.02659782 combined cost. This is one compatibility observation, not an independently verified invoice, repeatable yield or production cost forecast.

Roxanne marked the Supabase and Grafana event Maybe because it fits her background, and declined the AWS event because the company-name requirement made access uncertain. On October 13 she expressed interest in a manually checked Lenny PM meetup. That feedback is recorded in a private review pack, not an ingested draft, RSVP or public event.

### Relationship to the original handoff

The September 29 handoff's four areas are substantially implemented: safe extraction diagnostics, NYC timezone provenance, career discovery with reviewed display, and private lead recovery. The focus has since become career-first, with scoring calibration and attendance choices added. Broad community coverage and user usefulness remain open. Deferred ideas from the handoff are future options, not missing commitments in that increment.

## Pilot functional requirements

P0 requirements are necessary for a hosted NYC pilot. Existing safeguards must be retained. New requirements need separate implementation approval. P1 items improve pilot learning and should follow evidence of need.

| ID and priority | Requirement and release acceptance                                                                                                                                                   | Status                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| FR1 P0          | Current event feed: show only approved, non-fixture NYC career events in the supported window. Never display private drafts or substitute samples silently.                          | Local implementation exists. Hosted freshness needs acceptance.          |
| FR2 P0          | Useful coverage: evaluate at least three approved discovery attempts against a frozen source set and window policy. Manually verify every proposed public draft and document misses. | Small live checkpoints exist. PM coverage remains open.                  |
| FR3 P0          | Decision clarity: expose reasons, uncertainty and access cautions. In user research, distinguish career relevance from attendance eligibility.                                       | Display exists. User comprehension is unmeasured.                        |
| FR4 P0          | Human approval: recheck event and source snapshot, reject stale tokens, preserve approval history, and require an explicit publish action.                                           | Implemented locally. Hosted privileged access is new.                    |
| FR5 P0          | Safe shortlist: choices persist on the same browser where storage is available. Saving failures warn clearly. Choices do not RSVP or influence publication.                          | Implemented. Validate the selected hosted origin.                        |
| FR6 P0          | Profile selection: provide a small set of approved, versioned career targets without sending full résumés or contact details to models. Matching behavior must be explainable.       | One shared configurable target exists. Self-serve selection is proposed. |
| FR7 P1          | Feedback: collect voluntary event usefulness and attendance feedback with clear consent and deletion rules. Do not infer attendance from a link click.                               | Proposed. No telemetry currently exists.                                 |

### Non goals for the first release

Automatic registration or outreach, hiring guarantees, multi-city discovery, semantic cross-platform deduplication, personalized model training, subscription billing and an employer marketplace are excluded. Accounts, reminders, cross-device saves and a browser review inbox are conditional follow-ups rather than default pilot requirements.

## Operational requirements and release criteria

### Safety and privacy

- Keep free plan mode free of credentials, network calls and database writes. Require explicit live opt-in and an approved spending policy.
- Preserve capture bounds, no retries, no model fallback, source verification, sibling isolation and one conditional fact-preserving repair.
- Keep secrets, source text, prompts, raw provider errors and reasoning traces out of public fields and safe console diagnostics.
- Require authenticated, authorized operators before exposing privileged review workflows on a hosted service. Anonymous visitors receive only public projections.

### Freshness and operations

Before launch, define a refresh cadence, failed-run alerts, cancellation handling and an operator review service level. Current manual ingestion does not establish continuous freshness. Published facts are protected from automatic overwrites, so changed listings require a designed re-review path, not a silent refresh of approved facts.

Choose either a single persistent SQLite deployment with tested backups and restore, or managed Supabase/Postgres with least-privilege access. Do not deploy SQLite to an ephemeral filesystem or presume that multiple web instances share one local file. Define recovery time and acceptable data loss with the selected host, then test those targets.

### Accessibility and performance

Retain keyboard controls, focus recovery, clear errors and mobile layouts. Before launch, test the hosted experience with assistive technology and representative devices. Set performance budgets from the first hosted baseline rather than inventing current latency or availability claims.

### Launch checklist

- Current facts and every published draft pass original-listing review, including access caveats and registration URLs.
- At least three separately authorized discovery evaluations meet the proposed coverage and factual-quality criteria.
- The full offline suite, production build, page/runtime checks and chosen backend integration checks pass against the release revision.
- Production secrets, operator authorization, backups, restore and failed-ingestion alerts are verified without exposing private evidence.
- Proposed pilot thresholds and the spending policy are approved. No unresolved critical privacy, publication or data-loss defect remains.

## Roadmap and dependencies

This is a proposed sequence of release gates, not a calendar commitment. Estimate dates after selecting the spending policy, deployment approach and pilot scope. User recruitment and live evaluation are separate dependencies from development.

| Milestone             | Work and exit gate                                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Useful PM discovery | Resolve the hard-budget policy. Evaluate direct PM communities and useful technical alternatives with original-listing checks. Exit with repeatable, accessible leads and documented failure/miss analysis.            |
| 2 Decision quality    | Test relevance, practical access and uncertainty with target users. Compare scores with human decisions. Add only evidence-backed scoring or explanation changes. Exit when proposed decision-quality targets are met. |
| 3 Hosted NYC pilot    | Deploy with persistent storage or managed Postgres, operator authorization, backups, freshness operations and versioned target selection. Exit with a safe hosted journey and release checklist evidence.              |
| 4 Self-serve product  | Use pilot results to prioritize reminders, saved-history or account sync. Expand profiles and communities before adding cities. Exit with sustained usefulness and supportable cost per verified event.                |

### Next actions

- Approve a spending policy before another paid PM acceptance attempt. Do not lower the existing ceiling silently.
- Use the manually checked Lenny meetup as one positive PM example, while keeping its date, approval requirement and unknown price explicit.
- Define a small research cohort and compare attendance decisions with score explanations. One user's preference is a starting point, not calibration.
- Decide whether the initial hosted pilot keeps one shared profile or offers a small approved profile selector. Build accounts only if the pilot needs them.

### Avoiding unnecessary work

Do not add another cheap repair model, another general hardening cycle or a broad database rewrite without a reproduced failure or product reason. The current bounded repair path already exists. New source adapters should follow verified listing patterns and a coverage gap.

## Success measures and pilot evaluation

All thresholds below are proposed pilot hypotheses. There is no current user cohort, funnel telemetry, retention baseline or measured job-placement impact. Approval is required before treating these numbers as release commitments.

| Measure                   | Definition and proposed threshold                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Useful decision rate      | At least 70% of pilot participants identify one event they would consider attending in a seven-day evaluation. Count Interested or Maybe only with a stated reason.            |
| Discovery yield           | At least two distinct, manually verified relevant leads per 14-day window in two of three authorized evaluations. Three is a test batch count, not a guaranteed search result. |
| Core factual accuracy     | 100% agreement for published title, date/time, NYC physical location and registration identity at review time. One material conflict blocks that event.                        |
| Explanation comprehension | At least 80% of pilot participants correctly distinguish career-fit ranking from access certainty and hiring probability in a moderated task.                                  |
| Operational guardrails    | Zero private-draft leaks, automatic publications or unauthorized paid attempts. Measure actual review effort and verified billing before approving a cost target.              |

### Research design

Recruit five NYC PM or technical-PM career entrants for a proposed two-week pilot. Begin with moderated tasks before adding analytics. Ask users to choose events, explain why, identify restrictions and describe what information is missing. Compare the ranked list with a date-only list to test whether ranking improves decisions.

Track discovery attempts, accepted drafts, rejected reasons, operator review time and original-listing discrepancies. If participants consent, collect self-reported registrations, attendance and useful conversations separately. A click is not attendance, and a useful conversation is not a job offer.

### Cost and release decisions

Cost per usable verified event equals independently checked total discovery spend divided by unique, manually verified usable drafts for the same evaluation batch. Report model and search fees separately when available. A zero-draft batch has no finite per-event value. Missing cost evidence remains unknown.

Do not claim time saved, improved hiring outcomes or scalable economics until a measured baseline and comparison exist. Small-sample pilot results guide iteration and are not population estimates.

## Risks and product decisions

| Risk                           | Mitigation and unresolved decision                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosted search cost             | The guarded PM runner refuses the current envelope under the $0.15 ceiling. A dated conservative reservation of $3.2466 is a bound calculation, not an expected bill. Decide strict refusal, a separately authorized monitored policy, or application-controlled search. |
| Sparse or repeated results     | Audit communities and individual listing paths. Track distinct sources and coverage misses. Expansion exclusions do not prove semantic uniqueness or exhaustive search.                                                                                                  |
| Plausible but wrong facts      | Retain local capture, exact quote checks and human semantic review. Source text can be stale or inaccessible. Valid JSON and quote presence alone do not establish truth.                                                                                                |
| Ranking overconfidence         | Keep unknowns visible, score versions explicit and access separate from relevance. Test direct PM positive controls and user decisions before changing weights.                                                                                                          |
| Operator bottleneck            | Measure review time and backlog before automating cadence or building an inbox. Preserve approval even if throughput is limited.                                                                                                                                         |
| Hosted privacy and persistence | Choose storage and authorization deliberately. Browser saves are not accounts or encrypted personal records. Define consent before adding telemetry.                                                                                                                     |

### Decisions requested

Approve or revise the hosted NYC pilot definition, its initial audience, spending policy and proposed evaluation thresholds. Choose a shared-profile pilot or limited self-serve profile selection. These decisions precede new paid testing, deployment and roadmap implementation.

### Ownership

Roxanne owns product direction, priorities, acceptance decisions and user research. Implementation has been developed through AI-assisted collaboration under her direction. Hosting, operational review and ongoing support ownership must be assigned before launch.

### Evidence references

Repository evidence at the reference revision:

- [Project overview](../../README.md)
- [Career target configuration](../../config/career.json) and [model configuration](../../config/ingestion.json)
- [Career discovery and dated feedback](../CAREER-EVENTS.md)
- [Attendance shortlist and dated verification](../ATTENDANCE-SHORTLIST.md)
- [Storage](../STORAGE.md) and [source evidence](../SOURCE-EVIDENCE.md)
- [Human review and publication](../REVIEW-PUBLISH.md)
- [PM discovery preparation](../PM-DISCOVERY-PREPARATION.md) and [cost feasibility](../PM-COST-FEASIBILITY.md)

These relative links open current files. Use the reference revision for the original implementation snapshot. Historical scope came from the September 29 ROXY_HANDOFF.md supplied locally. Private listing evidence and user feedback are summarized here without committing raw captures or local review packs.

[RightRoom repository](https://github.com/RoxanneLai/rightroom)

This planning task did not query or change existing databases, make paid calls, publish events, install dependencies, commit or push.
