# RightRoom

**Find the events that move your career forward.**

RightRoom helps job seekers choose in-person events where relevant people, companies, and professional conversations are already happening. Built with **Next.js, TypeScript, SQLite, optional Supabase/Postgres, and OpenRouter**, it combines AI-assisted discovery with explainable career-fit ranking, source provenance, and human review before publication.

![RightRoom's fictional career sample, showing a ranked event card, career-fit explanations, and uncertainty cautions](docs/images/rightroom-career-sample.jpg)

_Screenshot of the career sample edition. Events, people, scores, and availability are fictional—not live listings or measured career outcomes. Run locally and visit `/sample/career` to explore it without credentials or paid API calls._

## Product overview

**User problem.** Job boards surface openings, but do not answer: _which rooms are worth showing up to?_ RightRoom grew out of Roxanne's own transition into product management and the difficulty of prioritizing local networking opportunities with limited time. The initial audience is NYC career changers seeking relevant professional communities and genuine conversations—not guaranteed jobs or access to recruiters.

**Product decisions.** Start with a focused NYC product-management and technical-delivery profile. Rank events using explicit evidence for role fit, relevant people, interaction, domain fit, and practical access; show reasons and uncertainty rather than an unexplained score. Capture original listing text, reject incomplete or conflicting candidates, and require human review before publishing. Keep the default experience local-first with SQLite, no Docker, and a separate credential-free sample edition.

**Result today.** A working career-first dashboard, configurable discovery pipeline, private draft review, stale-safe publication, and source-linked event cards. Live collection has produced drafts, and a manually checked career lead has been recovered and explicitly published. The code is covered by 246 deterministic offline tests plus production-page/runtime checks. The October 5 career expansion pilot produced one new private draft with canonical extraction and no repair. New scores conservatively limit weak role/networking evidence, with review warnings and contextual handling of technical demonstrations and informal conversation; repeatable discovery quality and ranking usefulness remain under evaluation. No user-impact or job-placement results are claimed.

**My contribution.** Roxanne defined the user problem, directed the shift from startup networking to career-event discovery, prioritized features and safeguards, and guided iterative implementation and validation with AI coding assistants. The code was developed through that AI-assisted collaboration.

## Current milestone: career discovery with human review

RightRoom began as FounderRadar, a working NYC startup-event prototype. That version established the core product mechanics: a static Next.js experience with six fictional events and deterministic ranking, followed by a local-first persistence layer, bounded agentic discovery, live draft collection, source provenance, and a human review boundary. Live runs remain unpublished until explicit approval.

Career discovery is now the default ingestion profile. It finds physically attended NYC product and technical-delivery events, including substantive company engineering talks and financial-technology communities. A configurable, non-personal target profile guides discovery; separate explainable career scores rank supported role fit, people, interaction, domain fit, and practical access. Founders and advertised jobs are not required. Explicit `--profile founder` retains the original startup-focused search and historical compatibility.

The homepage at `http://localhost:3000` ranks published, non-fixture NYC career events from SQLite by default; `/career` remains a compatible address for the same feed. `/events` preserves the broader all-published feed, including original founder listings. `/sample/career` shows three clearly fictional career examples, and the original fictional startup edition remains at `/sample`. Database errors and an empty career feed have distinct states; they never silently substitute samples or founder-only events. Supabase remains available through explicit configuration.

See [career discovery](docs/CAREER-EVENTS.md) for targeting, search budgets, scoring, and limitations, and [private lead recovery](docs/RECOVERY.md) for moving a failed lead into ordinary draft review using freshly checked evidence. Fresh career discovery has passed small live compatibility checkpoints; weak role-fit and networking evidence in the [latest pilot](docs/CAREER-EVENTS.md#current-live-checkpoint--october-5-2026) motivated [version 4 scoring gates](docs/CAREER-EVENTS.md#context-and-negation-follow-up--version-4). Human evaluation is still needed before treating scores as useful recommendations.

See [the storage guide](docs/STORAGE.md) for SQLite, backend selection, import, backups, and deployment limits. The [dashboard guide](docs/DASHBOARD.md), [ingestion guide](docs/INGESTION.md), [quality-evaluation guide](docs/INGESTION-EVALUATION.md), and [review guide](docs/REVIEW-PUBLISH.md) cover each workflow. Historical readiness and integration checkpoints describe the earlier Supabase-first implementation.

The local [draft-review workflow](docs/REVIEW-PUBLISH.md) lets an operator list upcoming and expired drafts separately, inspect private evidence, preview public card data, and explicitly approve one event for publication. Only the reviewed canonical listing URL becomes public; stale approvals are rejected. Run `npm run review` for offline help. No real events were published during the historical [overnight verification](docs/REVIEW-PUBLISH-PROGRESS.md).

### Preview an ingestion run without spending money

```bash
npm run ingest -- --limit 3
npm run ingest -- --profile founder --limit 3
```

After installing dependencies, these print plans only: no API requests, key-file reads, database initialization, or writes. The default career plan covers 30 days; explicit founder mode covers 14. Both retain the default three-search budget. Career plans read the non-secret `config/career.json`, with an optional `--career-config` override. Historical saved runs lacking a profile still mean founder; changing defaults does not migrate or rescore data.

The agent uses OpenRouter, with primary and schema-repair model/effort defaults in `config/ingestion.json` and independent per-run overrides. A live run makes one research request, captures bounded public listing text privately, then makes one tool-free extraction request if any captures succeed. A safely source-scoped noncanonical JSON response may trigger at most one tool-free repair request. Live mode reads your ignored `OPENROUTER.key` file and still requires explicit opt-in and a separately approved testing budget. Supabase credentials are required only when that backend is selected. See [source evidence](docs/SOURCE-EVIDENCE.md) for capture limits, failure behavior, and historical compatibility. Fresh career runs have reached draft persistence without manual recovery; live compatibility is distinct from human listing review, ranking calibration and publication approval.

Completed local runs can be inspected without paid requests or database writes using `npm run ingest:inspect -- --run RUN_UUID`. The report contains safe diagnostics and source identities, never source content or raw payloads.

Historical ingestion quality can be measured offline with `npm run ingest:evaluate -- run`. The evaluator opens the selected SQLite database read-only, merges only allowlisted aggregate fields from ignored checkpoints, and writes an owner-only aggregate report under `codex-tmp/`. It does not read a key, contact a provider, modify the database, or publish events.

Discovery defaults to refreshing eligible listings. Opt-in `--intent expand` steers research away from source identities already linked to non-fixture events in the chosen window, while retaining failed unlinked leads. Its bounded, cancelled-first exclusion list reports truncation and leaves all existing publication safeguards intact. Preview it free with `npm run ingest -- --intent expand --limit 3`; see [refresh versus expansion](docs/INGESTION.md#refresh-versus-expansion). One successful live expansion recovered an existing unlinked lead into a new draft; broader coverage and repeatability are not established.

Private saved provider responses can be replayed through the current adapter with `npm run ingest:replay -- run --manifest codex-tmp/capture-replay-manifest.json`. Replay is SQLite-only and offline: it reads no credentials, makes no paid calls, and writes neither database rows nor publication changes. Its ignored manifest distinguishes original failure captures from later diagnostic captures.

## Run the web application

Use Node.js 24 LTS and npm.

```bash
npm ci
npm run dev
```

Open http://localhost:3000.

For the credential-free showcase, open http://localhost:3000/sample/career. No hosted demo is currently provided.

No database configuration is needed for the default SQLite dashboard. Its persistent ignored file is created automatically. No service-role key or OpenRouter key is needed for page loads. A new database is intentionally empty; open `/sample/career` to see the career demo. Starting the page does not run discovery or publish anything.

## Storage

SQLite is the default and needs no separate process. All local workflows use `data/founder-radar.sqlite` unless `SQLITE_DATABASE_PATH` overrides it. Set `DATABASE_BACKEND=supabase` to opt into the retained Supabase implementation; there is no automatic fallback or data transfer.

See [the storage guide](docs/STORAGE.md) before importing, backing up, restoring, or deploying data.

### Optional local Supabase

Local Supabase requires a Docker-compatible container runtime. Start your runtime, then start the optional local stack:

```bash
npm run db:start
```

Supabase Studio runs at http://localhost:54323. Stop the local stack with `npm run db:stop`.

Use `db:start` for ordinary startup; resetting the database is not part of the daily workflow. These scripts operate on the local stack, which is for development only and must not be exposed publicly.

To apply newly added migrations without resetting existing data, run `npm run db:migrate`.

After changing local service configuration, use `npm run db:stop` followed by `npm run db:start`. The default stop preserves local data; never add `--no-backup`. Authentication is enabled for local API credentials, not for a public login or sign-up feature. `npm run db:status` displays local credentials: keep that output private and use only the anonymous/public key for the dashboard.

The Supabase database is reproducible from committed files:

| Path                       | Responsibility                                          |
| -------------------------- | ------------------------------------------------------- |
| `supabase/config.toml`     | Local service and database configuration                |
| `supabase/migrations/`     | Versioned database schema                               |
| `supabase/seed.sql`        | Six deterministic fictional events and their provenance |
| `supabase/tests/database/` | pgTAP database contract tests                           |

Never commit hosted Supabase credentials, service-role keys, `OPENROUTER.key`, downloaded live data, or `.env` files.

### Optional: rebuild the local fixture database

**Destructive:** `db:reset` deletes this project's local database contents, including any live listings you have collected, and replays migrations plus fictional seed data. Back up data you want to keep first. Run this only when you deliberately want a fresh fixture database:

```bash
npm run db:reset
```

This command does not reset or deploy a hosted Supabase project.

## Data flow

The schema is designed for discovery before normalization:

1. A discovery agent creates a `search_runs` record.
2. Each selected listing is upserted into `event_sources` with its URL and provider identity. New live runs retain bounded source-page text privately in run metadata; successful drafts retain that snapshot on their source. Historical runs retain their original model-report evidence format.
3. A source may remain unlinked while extraction is incomplete.
4. Normalized sources are linked to canonical `events` records.
5. Only events explicitly marked `published` are readable through the public application role.

The manual review boundary records a private approval snapshot in `event_publication_reviews` and exposes only a selected canonical `public_registration_url` on the event. Publication never happens as a side effect of discovery or a page load.

This preserves the latest source snapshot and its original discovery-run attribution. It does not yet retain every historical fetch; append-only observations can be added when needed. Raw source records and search-run diagnostics are not publicly readable. The main dashboard explicitly excludes seeded events marked `is_fixture = true`.

## Application architecture

| File                         | Responsibility                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `lib/types.ts`               | Original fixture contract and shared categories                                        |
| `lib/mock-events.ts`         | Fictional fixtures used only by the sample edition                                     |
| `lib/dashboard/`             | Server-only reads, validation, public card contract, and sample adapter                |
| `lib/storage/`               | Backend selection, SQLite schema, and explicit Supabase import                         |
| `lib/review/`                | Local operator CLI, evidence review, public preview, and explicit publication          |
| `lib/career/`                | Target profile, strict evidence, explainable career assessment, and fictional examples |
| `lib/recovery/`              | SQLite-only private lead recovery with freshness, preview, and transaction audit       |
| `lib/events.ts`              | Deterministic ranking, score bands, and formatting                                     |
| `components/EventCard.tsx`   | Event presentation                                                                     |
| `components/Dashboard.tsx`   | Shared dashboard presentation and feed states                                          |
| `app/page.tsx`               | Career-first homepage with request-time published career ranking                       |
| `app/events/page.tsx`        | Broader published feed, retaining original networking-score ranking                    |
| `app/sample/page.tsx`        | Separate static fictional edition                                                      |
| `app/career/page.tsx`        | Compatible address for the career homepage                                             |
| `app/sample/career/page.tsx` | Fictional career shortlist, independent of storage                                     |
| `supabase/`                  | Optional Postgres persistence, provenance, seed data, and database tests               |

The server-only ingestion code lives in `lib/ingestion/`, its manual entry point is `scripts/ingest.ts`, and generated database types live in `lib/database.types.ts`. Ingestion remains separate from the read-only dashboard; page loads never make paid API calls.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:next
npm run test:next:runtime
```

Run `build` before the two production checks. `test:next:runtime` uses only synthetic HTTP responses and temporary local ports; it needs permission to start local servers. The normal suite exercises SQLite with isolated ignored temporary files. Run just the eight full-workflow synthetic checks with `npm run test:acceptance:offline`; see the [offline acceptance guide](docs/OFFLINE-ACCEPTANCE.md) for scope and limitations. The following optional Postgres checks require local Supabase:

```bash
npm run db:test
npm run db:lint
```

The database contract tests expect the fictional seed events. Prefer `npm run db:test:isolated`: it creates a disposable database inside the local Supabase Docker container, applies migrations and seeds, runs contracts, the real review CLI, and concurrency checks, and removes only that disposable database. Do not reset a database containing data you want to keep just to run tests. See the [review checkpoint](docs/REVIEW-PUBLISH-PROGRESS.md) for current verification and local installation limitations.

## Roadmap

| Status                 | Scope                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Completed              | FounderRadar startup-event proof of concept; database schema, provenance, fixture seeds, and contract tests                  |
| Live checkpoint passed | OpenRouter discovery, source verification, generalized bounded schema repair, SQLite draft persistence, and tests            |
| Current                | RightRoom product positioning for job seekers choosing high-value in-person professional events                              |
| Implemented and tested | Career-first configurable discovery and homepage, evidence-based ranking, samples, timezone provenance, and private recovery |
| Live checkpoint passed | Fresh career expansion recovered one unlinked lead into a private draft with canonical extraction and protected history      |
| Next                   | Evaluate calibrated ranking usefulness, resolve attendance caveats, and make separate publication decisions                  |
| Implemented and tested | Database-backed dashboard, separate sample edition, unknown-field handling, and loading/empty/error states                   |
| Implemented and tested | Local private draft review, public preview, explicit stale-safe publication, and canonical registration links                |
| Implemented and tested | Read-only SQLite quality evaluation with recent-cohort, conversion, compatibility, usage, and cost metrics                   |
| Later                  | Additional providers, cross-source deduplication, scheduling, and broader personalization                                    |

The database read boundary and dashboard integration are implemented. Local migrations, authentication, and database/API access are verified in the [readiness checkpoint](docs/LOCAL-READINESS.md). Fresh run `edc10f58-32cd-4ab6-9f50-4317358c5139` exercised the generalized JSON repair boundary end to end: one unfamiliar extraction structure became one canonical, scalar-preserving draft with no errors. The draft remains private pending manual comparison with its current Meetup page. Interrupted runs can be listed, previewed, and explicitly closed without deleting their audit history. Real event collection does not depend on finishing AI scoring first.

## Historical development records

RightRoom is the product name. Some internal database filenames, ingestion identifiers, Docker resources, migrations, and historical documents still use `founder-radar` or FounderRadar so existing data and workflows remain compatible. Renaming those identifiers is separate from changing the product focus.

The original FounderRadar [V0 walkthrough](docs/archive/V0-WALKTHROUGH.md) and [complete-code snapshot](docs/archive/V0-COMPLETE-CODE.md) are archived records of the browser-based ChatGPT development phase. Their contents are intentionally preserved, including the former product name, obsolete commands, and setup details. Use this README and the actual source files for current development. The formatter skips `docs/archive/` to avoid rewriting those snapshots.
