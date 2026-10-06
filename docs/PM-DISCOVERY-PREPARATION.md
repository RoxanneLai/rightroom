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

## Budget-checked Terminal runner

`npm run ingest:pm:acceptance` defaults to a free plan: it resolves a new fourteen-day window, pins career/product/expand, three searches, three listings, Luna/medium for both primary and repair, and the approved $0.15 ceiling. It reads only non-secret configuration. It does not read `OPENROUTER.key`, select/open storage, create artifacts, or make network requests. There is no flag to raise the budget, change models, or enable retries.

The separate read-only preflight can be launched in regular Terminal:

```sh
DATABASE_BACKEND=sqlite \
SQLITE_DATABASE_PATH=data/imported-founder-radar.sqlite \
npm run ingest:pm:acceptance -- --preflight
```

Preflight fetches the public model catalog first. It reserves the entire advertised context at the most expensive advertised input/output tier, includes possible cache-write surcharges, all output allowances, and three Exa Auto searches at the fixed $0.007/search assumption recorded during preparation. Research reserves four full model passes for its three possible tool continuations; extraction and conditional repair each reserve one. Each reservation rounds upward to integer microdollars before summation. It does not use historical $0.03-ish runs, average token ratios, missing costs as zero, or a key limit to claim a hard spending bound. Model catalog `web_search` pricing describes native search and is not substituted for the explicitly selected Exa tariff. The offline hardening pass did not reverify current tariffs. See [OpenRouter search pricing](https://openrouter.ai/docs/guides/features/server-tools/web-search#pricing) and [credit-limit behavior](https://openrouter.ai/docs/api/reference/limits).

**The current conservative envelope does not fit $0.15.** An offline calculation using the public catalog values examined during preparation (1,050,000-token context; maximum input tier plus cache-write surcharge $0.90/million; maximum output tier $1.80/million) reserves $5.7666. That is a deliberately loose full-context bound, not an expected bill or a recommendation to spend that amount. A preflight using those values stops with `acceptance_budget_exceeded` before reading credentials, opening the database, making a backup, creating a run, or sending any paid request. The runner fetches current catalog data itself; this dated example is not a cached authorization or pricing override.

Only if the whole envelope fits does preflight inspect existing schema-v2 SQLite storage read-only and check the key and key-visible model catalog. Invalid/missing capabilities, unknown pricing/fees, insufficient access, or mismatched catalogs stop safely. It does not edit the key or account settings. It saves owner-only plan/budget/stop artifacts under ignored `codex-tmp/`; these artifact writes are not database writes. A failed check is not retried.

The explicit live mode also requires `FOUNDER_RADAR_ALLOW_PAID_API=1` and the same database environment. It performs all gates again, verifies window freshness, backs up committed WAL contents, and reuses the existing ingestion/provider/capture implementation for exactly one attempt. A guarded provider transport preserves pinned model/effort, bounded Exa settings, strict tool-free extraction/repair, no fallbacks and excluded reasoning; it adds [provider price filters](https://openrouter.ai/docs/guides/routing/provider-selection#maximum-price). The prompt filter uses the maximum advertised prompt component (`prompt_usd_per_token`), separately from the conservative combined input/cache-write reservation. No separate cache-write price filter or endpoint-fee verification is claimed. Requests are sequential and at most three. Results and consulted draft/source snapshots are private; snapshots omit raw provider payloads and run metadata. Nothing is rescored, registered for, or published automatically.

## Offline budget-guard hardening — October 6, 2026

Every envelope is strictly validated, its full-context phase reservations and total are recomputed, and the transport takes its own deeply frozen copy. Overwriting a total, a phase reservation, or a rate cannot disguise inconsistent calculations or mutate the guard after creation. This checks internal consistency, not the authenticity of externally supplied prices; the runner still obtains its pricing from the public and key-visible catalogs.

The transport independently rejects oversized UTF-8 inputs before any paid request. Limits include the complete outgoing JSON body with injected price filters and the combined decoded system/user messages:

| Phase      | Outgoing body | Combined messages |
| ---------- | ------------: | ----------------: |
| Research   |       128 KiB |           112 KiB |
| Extraction |       768 KiB |           576 KiB |
| Repair     |       768 KiB |           384 KiB |

These are defensive byte limits, **not billed-token estimates or a smaller spending reservation**. Unicode and nested JSON escaping are counted; source text, prompts and schemas are never silently truncated. Oversized inputs fail with `budget_input_too_large`. Existing capture, quote-grounding, relevance, repair and publication validation remains unchanged.

A suspicious successful response now fails immediately, including on the final extraction or repair call: `budget_model_mismatch` for a different returned model, `budget_cost_unverified` for missing/null/malformed cost, `budget_reported_cost_exceeded` for cost above its phase reservation, or `budget_response_unverified` for an unreadable, oversized or malformed verification envelope. HTTP authentication/quota errors retain the normal provider classification. Unknown transport exceptions become `budget_transport_failed`; raw errors, source content and reasoning traces are not exposed. A successful response is read once under the existing response-byte limit, avoiding a cloned-stream cancellation hang.

No subsequent paid request follows a response-verification failure, no reservation is refunded, and there are no retries or fallbacks. Safe error codes reach the normal run summary and private artifacts. Candidates from that failing response are not accepted as new drafts; previously successful stored evidence and events remain intact through the existing failed-refresh path. Provider-reported cost is still unverified billing data, and checking it after completion cannot undo an already billed overrun. The $0.15 ceiling and full-context refusal are unchanged.

These controls depend on the gateway honoring its documented model context, tool/output bounds, routing filters and advertised tariffs. They are not an unconditional guarantee about external billing, BYOK invoices, account-setting overrides or future search-price changes. Key/credit status is an additional access check, not proof that a running request cannot overshoot a limit. The runner currently **refuses** rather than claiming that a likely inexpensive run meets an absolute $0.15 guarantee. Do not launch older unguarded harnesses to bypass that refusal. A tighter independently justified input/tool-cost bound or a different explicitly approved spending policy is a separate decision; this preparation does not authorize either.

Offline tests use synthetic catalogs, gateway replies and isolated SQLite databases. They cover free modes, malformed flags, whole-attempt reservations and tier/cache pricing, early refusal without credentials/database access, immutable/consistent envelopes, Unicode and body/message bounds, routing filters, immediate model/cost failures, failed/cancelled/concurrent requests, real-provider/native-capture/SQLite composition, failed-refresh preservation, private snapshots and owner-only artifacts. No live execution or production-database verification occurred while preparing or hardening this runner.
