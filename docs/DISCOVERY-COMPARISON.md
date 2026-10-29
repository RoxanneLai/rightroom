# Controlled discovery comparison

## Purpose and current status

The next Milestone 1 experiment compares the existing marketplace discovery surface with the newly enabled Product Circle dated-event family. The harness is implemented and offline-verified; no live comparison arm has run and no result is claimed.

The experiment asks a narrow product question: under the same NYC technical-PM window and bounded discovery budget, does a focused first-party community source add usable, reviewable leads relative to marketplace discovery? It does not test attendance outcomes, job placement, general source quality or long-term repeatability.

## Free paired plan

Run:

```bash
npm run ingest:compare
```

Optional fixed settings are `--from`, `--to`, `--searches 1..3` and `--limit 1..10`. Supply both dates or neither. Plan mode reads only the checked-in non-secret career profile and prints two arms:

- `marketplace`: Luma, Meetup and Eventbrite individual listings;
- `product_circle`: strict dated Product Circle event listings.

Both arms use the same window, career profile, product focus, expansion intent, hosted-search budget and candidate limit. The plan shows the exact later ingestion arguments, allowed domains and planned query families. It makes no network request, reads no credential, opens no database, creates no artifact and authorizes no paid call.

## Live execution boundary

The planner does not execute either arm. Each live command remains an ordinary ingestion run and requires fresh, explicit authorization, `--live`, the paid-call opt-in, current pricing/budget review, a fresh live window and all existing credential, capture, validation and persistence safeguards.

Run the two arms separately and retain their run UUIDs. Do not retry or widen a zero-result arm merely to fill the requested slots. Do not publish results during collection. Product Circle capture compatibility for one known page does not guarantee discovery yield or future page availability.

Source scope is enforced at five boundaries: hosted-search domains, research instructions, citation acceptance, historical exclusion reads and final local source selection. Out-of-scope URLs cannot consume candidate slots or contaminate one arm's exclusion cap.

## Offline dress rehearsal

Before considering a paid pair, run:

```bash
npm run ingest:compare:rehearse
```

This credential-free test sends deliberate marketplace and Product Circle decoys through opposite arms, runs both real ingestion paths against a newly created ignored SQLite database, and passes their actual run UUIDs to the read-only evaluator. It requires both arms to create private drafts only, retain their source scopes, reject cross-scope candidates, leave the database byte-for-byte unchanged during evaluation, write an owner-only aggregate report under `codex-tmp/`, and make zero real network or publication calls.

The rehearsal proves integration and safety boundaries with synthetic evidence. It does not exercise OpenRouter, current event pages, live model behavior, pricing, relevance quality or discovery yield.

## Operator checklist for a later live pair

Before either arm:

1. Pull the intended commit and confirm the worktree is clean.
2. Run `npm run ingest:compare:rehearse` and keep any failure as a blocker.
3. Generate one paired plan with an explicit future window; do not edit one arm independently.
4. Confirm the selected SQLite database and create a recoverable backup using the storage guide.
5. Review current model and hosted-search pricing, set a separate approved ceiling for each arm, and obtain fresh authorization. A prior run or this rehearsal is not approval.
6. Confirm both commands can start while their shared `--from` timestamp is within the live-window freshness limit.

During collection:

1. Run the marketplace and Product Circle commands separately with their exact planned arguments, ordinary paid opt-in and `--live`.
2. Record each terminal run UUID, status and actual start/end time. Do not retry, widen the window or substitute sources when an arm returns zero.
3. Do not publish, recover or manually rewrite either arm before evaluation.

After collection:

1. Generate the private review packet from the two run UUIDs.
2. Review every item with the fixed relevance, access, price, factual-agreement and evidence-quality rubric; record actual review minutes and known misses.
3. Validate and aggregate the completed packet.
4. Optionally run the lower-level read-only evaluator for ingestion-funnel and provider-cost diagnostics.
5. Preserve the aggregate reports and keep the private packet out of shared artifacts.
6. Treat the pair as one learning observation, not proof of repeatability or permission for another paid run.

## Private operator review

Create an owner-only review packet after both arms finish:

```bash
DATABASE_BACKEND=sqlite SQLITE_DATABASE_PATH=data/founder-radar.sqlite \
  npm run ingest:compare:review -- prepare \
  --marketplace-run MARKETPLACE_RUN_UUID \
  --product-circle-run PRODUCT_CIRCLE_RUN_UUID
```

The default output is `codex-tmp/discovery-comparison-review.json`. It includes only the bounded fields needed for a human decision: source identity, title, schedule, location, format, price, registration state, career score and cautions. It never includes captured page text, raw provider payloads, research reports, prompts or model responses. The file is private, ignored by Git and written with owner-only permissions; do not publish or commit it.

For each item, fill every entry in its matching `judgments` object:

- `relevance`: `yes`, `maybe` or `no`;
- `access`: `yes`, `maybe`, `no` or `unknown`;
- `price_fit`: for known USD totals, `yes` at $0–$150 inclusive, `maybe` above $150 through $250 inclusive and `no` above $250; use `unknown` for missing or non-USD prices;
- `evidence_quality`: `sufficient`, `limited`, `conflicting` or `unavailable`;
- each factual verdict: `agree`, `conflict` or `unknown`;
- `disposition`: `usable`, `reject` or `follow_up`;
- `rejection_reason`: required only for `reject`, using one of the packet's fixed values;
- `duplicate_group`: the same short lowercase label for copies of the same event, otherwise `null`;
- `review_minutes`: whole minutes from 0 through 1440; and
- `notes`: optional private context, or `null`.

Add any known discovery misses to `misses` using the fixed `arm` and `category` values listed in the packet's rubric. Miss notes remain private. Do not edit `items`, `comparison`, `rubric`, `version` or `packet_hash`; the evaluator rejects stale or tampered evidence.

Validate and aggregate the completed packet:

```bash
DATABASE_BACKEND=sqlite SQLITE_DATABASE_PATH=data/founder-radar.sqlite \
  npm run ingest:compare:review -- evaluate \
  --input codex-tmp/discovery-comparison-review.json
```

The default result is `codex-tmp/discovery-comparison-review-results.json`. It contains aggregate counts only: operator and conservatively verified usable items, unique usable leads, factual conflicts, rejection reasons, follow-ups, miss categories and review time by arm. A verified usable lead requires a usable disposition, non-negative relevance, yes/maybe access and price fit, sufficient evidence and agreement on all four factual checks. Duplicate groups count once. The result omits source identities, URLs, event facts and private notes.

Both review commands open SQLite read-only, revalidate the paired run contract and make zero network, paid-provider, database-write or publication calls. Evaluation also rebuilds the expected packet from current SQLite state, requires exactly one complete judgment per item and fails closed if the packet is stale or modified outside the judgment and miss fields.

## Read-only evaluation

After both separately approved runs reach a terminal state in the same SQLite database:

```bash
DATABASE_BACKEND=sqlite SQLITE_DATABASE_PATH=data/founder-radar.sqlite \
  npm run ingest:compare -- evaluate \
  --marketplace-run MARKETPLACE_RUN_UUID \
  --product-circle-run PRODUCT_CIRCLE_RUN_UUID
```

Optional `--marketplace-review-minutes` and `--product-circle-review-minutes` values record actual operator effort. `--output` may select another JSON path under `codex-tmp/`.

The evaluator rejects a pair unless both runs are terminal and have matching windows, limits and search budgets with career/product/expand and their expected source scopes. It opens SQLite read-only, reads exactly those two run records and writes an owner-only aggregate JSON report. It does not read source text, research reports, URLs, raw provider responses or private event facts; it makes no network request, provider call, database write, publication change or retry.

Reported measures are:

- candidate-slot fill;
- capture attempts and success rate;
- usable private draft writes and write rate;
- provider-reported cost only when every recorded request has a numeric cost;
- review-item workload proxy; and
- actual review minutes and minutes per draft when supplied.

These measures need interpretation. A draft is not an approved recommendation, a discovered source may duplicate an event across platforms, provider cost fields are unverified, and one paired window cannot establish repeatability. Use the private operator review above for decision-quality judgments; the lower-level evaluator remains useful for ingestion-funnel and cost diagnostics.

## Milestone decision rule

This first pair is a learning run, not the Milestone 1 exit by itself. Preserve its aggregate report, review both arms consistently and document misses. The roadmap still calls for at least three separately authorized evaluations meeting the proposed yield and factual-quality gates before claiming repeatable discovery.
