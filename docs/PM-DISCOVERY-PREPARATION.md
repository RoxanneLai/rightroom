# PM-focused discovery preparation

## Purpose and scope

The next product-validation milestone is a real PM-focused event to compare with the technical events already reviewed. The user's saved feedback was Maybe for Supabase/Grafana because of background relevance, and No for AWS because a company-name requirement made attendance uncertain. That does not establish ineligibility, calibrate the numeric scores, or authorize publication.

The normal three-slot career plan mixes product, company-technology and financial-technology families. Opt-in `--search-focus product` instead uses only the three already defined product families, in this order:

1. Product discovery, prioritization and analytics; ProductTank/Women In Product.
2. B2B/AI product management and career transition; Product School.
3. Product-practitioner networking; Supermomos/product communities.

These are research priorities and planned query text, not verified executed queries or dedicated community crawlers. They do not guarantee a current event, a PM attendee, hiring access or available registration. Listings must still resolve to supported individual sources and pass the existing capture, evidence, date, location and eligibility checks. A relevant technical event may still qualify; focus does not add a PM-only eligibility gate or upgrade weak role evidence.

## Free plan

Resolve one explicit fourteen-day window and print the plan without `--live`:

```sh
pm_from=$(node -p 'new Date().toISOString()')
pm_to=$(node -p 'new Date(Date.parse(process.argv[1]) + 14*86400000).toISOString()' "$pm_from")

npm run ingest -- \
  --profile career --search-focus product --intent expand \
  --searches 3 --limit 3 --from "$pm_from" --to "$pm_to"
```

Plan-only ingestion reads non-secret configuration, but never reads `OPENROUTER.key`, selects/initializes storage, makes provider or website requests, or writes database rows. Expansion counts remain unknown until an approved live run reads the selected backend. `--search-focus balanced` preserves the existing interleaved plan and is the implicit default for historical options lacking focus. Both focus values are career-only; product focus supports one to three search slots, while balanced career discovery retains one to twelve. Missing, empty, unknown, duplicate and incompatible flags fail closed before credentials or live storage access.

The effective focus is included in plans, research input/private research metadata, run checkpoints and both backends' search parameters. Scoring targets/weights, extraction schemas, bounded repair, source exclusions, historical assessments, publication protection and approval requirements are unchanged. No schema migration or new dependency is needed.

## Free preparation checkpoint — October 5, 2026

Preparation ran on `codex/pm-discovery-plan`, based on merged main `45b4156`. The saved plan pinned `2026-10-05T22:08:38.021Z` through `2026-10-19T22:08:38.021Z`, product/career/expand, three search slots and a three-listing cap. Primary and conditional-repair settings were Luna/medium; normal ingestion retains at most one research request, one extraction if capture succeeds, and one bounded tool-free repair if needed. The actual CLI plan passed with network/key access blocked and an invalid-backend sentinel, demonstrating that the free plan did not read storage configuration.

A separate read-only preflight of the explicitly selected `data/imported-founder-radar.sqlite` passed: integrity OK, schema version 2, all five required workflow tables present and zero foreign-key violations. The existing database was not initialized, migrated or changed. The preparation-only helper and owner-only plan/preflight results are retained locally under ignored `codex-tmp/`, not committed or used as test fixtures. It has no live execution mode. Generated scratch artifacts are writes to that ignored directory, not database writes.

There were zero paid requests, credential reads, website requests or database-row writes. No drafts were created, rescored or published. Provider/key access, current model catalog/pricing, current community listings and registration availability were not tested. This is local readiness, not a successful live PM-discovery result or a monetary spending guarantee. Any later live run must resolve a new fresh window; do not reuse the dated checkpoint beyond the live-window grace period.

Verification passed formatting, lint, TypeScript, `git diff --check`, all 260 deterministic offline tests (6 unit, 219 ingestion, 22 dashboard, 13 review), a production build, 3 compiled-page checks and 13 runtime checks in a fresh credential-free copy under ignored `codex-tmp/`. Nine new tests cover unchanged balanced/historical plans, the exact focused subset, strict CLI/budget rules, immutable normalization/scoring and ineligible rejection, guarded free plans, early configuration failure, offline gateway input/metadata, checkpoints and SQLite/mocked-Supabase persistence. Real PostgreSQL integration and live discovery quality were not tested.

## Later live acceptance — not authorized by preparation

Before execution, separately confirm the model/access and an explicit numeric spending budget, resolve a fresh window and back up the selected SQLite database including committed WAL contents. Bounded requests alone do not enforce a dollar ceiling. Use one attempt with the same product/career/expand, three-slot/three-listing limits; do not retry failures, increase the budget or publish automatically. Existing paid opt-in and credential requirements still apply.

Afterward, preserve the run ID and snapshot its drafts before another attempt could refresh overlapping sources. Check each draft against its original listing, especially genuine PM practice/community relevance, in-person NYC attendance, the exact date/window, registration route, company/membership requirements and any host approval. Technical overlap does not establish PM contacts or hiring. Unknown fields remain unknown; uncertain eligibility is not proof of exclusion. Source grounding is not semantic verification.

Ask for Yes/Maybe/No attendance feedback and compare with the prior technical examples. A verified PM-focused draft would supply the missing real positive control, not prove general recommendation quality. Zero usable drafts is a result to review, not a reason for an automatic rerun. Publication remains a separate explicit human decision.
