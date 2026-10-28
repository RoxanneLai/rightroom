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

These measures need interpretation. A draft is not an approved recommendation, a discovered source may duplicate an event across platforms, provider cost fields are unverified, and one paired window cannot establish repeatability. Human review should record relevance, access, price fit and evidence quality before deciding whether Product Circle deserves continued discovery budget.

## Milestone decision rule

This first pair is a learning run, not the Milestone 1 exit by itself. Preserve its aggregate report, review both arms consistently and document misses. The roadmap still calls for at least three separately authorized evaluations meeting the proposed yield and factual-quality gates before claiming repeatable discovery.
