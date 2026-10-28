# Database-backed dashboard

## RightRoom product focus

RightRoom helps NYC technical professionals exploring product-management and technical-PM roles choose worthwhile in-person professional events. `/` is the technical-PM pilot homepage; `/career` remains a compatible address for the same reviewed assessments ranked by experimental PM relevance for one shared, non-personal profile. `/events` preserves all published NYC events, including the original founder listings. `/sample/career` is a separate fictional technical-PM example with build-relative upcoming dates, explainable components, founder applicability, hiring unknowns, and caveats. `/sample` retains the original startup edition and legacy score meanings. Both real feeds keep drafts/evidence private and require existing explicit publication review. See [career targeting and ranking](CAREER-EVENTS.md).

The product name, page titles, recommendations, and job-seeker messaging use RightRoom. Internal database filenames and service identifiers retain `founder-radar` for compatibility with existing local data. See the [README](../README.md) for the audience, product direction, and roadmap.

## What changed

The main route (`/`) reads the selected local database at request time. SQLite is the default; Supabase remains optional. The original fictional edition is at `/sample`, with clear labels, no registration links, and indexing disabled. There is no automatic sample fallback when the database is empty or unavailable.

After SQLite's schema initialization, page loads only read events: they never run the ingestion agent, make paid model calls, calculate scores, or publish drafts. Changing the homepage does not migrate data or add career assessments to founder-only records.

An empty career shortlist can coexist with published founder-only events. Its explicit “Browse all published events” link opens `/events`; no broader records are silently substituted. Retry and sample links stay in their respective edition. The career sample returns to `/`, while the original startup sample returns to `/events`.

Cards also support a [browser-local personal attendance shortlist](ATTENDANCE-SHORTLIST.md): Interested, Maybe, Not for me, and filters for those choices. This does not RSVP, change scores, publish anything or write database rows. Published views share choices; each fictional sample keeps separate preferences. Only currently loaded server-projected events can appear, and storage failures leave the feed readable.

## Start with SQLite

No database credentials or separate server are required:

```bash
npm ci
npm run dev
```

The first request creates the ignored `data/founder-radar.sqlite` database and schema. Use `SQLITE_DATABASE_PATH` to choose another persistent private file. Dashboard, ingestion, run inspection, and review must use the same value. See [STORAGE.md](STORAGE.md) for backups and deployment limits.

## Optional Supabase dashboard

1. Keep Docker Desktop running and use `npm run db:start` for ordinary startup. Do **not** reset existing data.
   Apply pending migrations with `npm run db:migrate` after reviewing them. The reviewed-link addition requires `20260902061000`; without its new column, the updated feed returns its safe unavailable state.
2. In your regular Terminal, run `npm run db:status` to find the local API URL and anonymous/public key. Keep the output private: it also includes privileged credentials. If upgrading from the earlier auth-disabled configuration, run `npm run db:stop` followed by `npm run db:start` first; do not use `--no-backup` or reset the database.
3. Set the explicit backend plus the following values in your own ignored `.env.local`, or export them in the Terminal used to start Next.js. Replace the placeholder with the local anonymous/public key, never the service-role/secret key:

   ```dotenv
   DATABASE_BACKEND=supabase
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_ANON_KEY=<local-anonymous-or-publishable-key>
   ```

4. Run `npm run dev` and open `http://localhost:3000`. Restart the server after changing environment values.

The dashboard accepts a local loopback URL with an explicit port only. The current local stack enables authentication with sign-ups disabled. This supplies separate public-read and privileged-ingestion credentials without adding a login screen.

The dashboard accepts an anonymous-role JWT or a public `sb_publishable_` key and rejects service-role/secret keys. Supabase authenticates the key; the configuration check is an additional guard against accidental privileged access. A failed authenticated request never automatically retries without credentials. Hosted endpoints and credentials embedded in URLs are rejected. When no key is configured, the SDK construction placeholder is stripped before any request. The verified local stack also allows keyless public event reads, but both keyless and anonymous-key requests remain blocked from private source evidence, runs, and review history. Explicitly configuring the anonymous/public key avoids relying on that local gateway behavior.

No `OPENROUTER.key`, model selection, or paid opt-in is needed for the dashboard. Do not put a service-role credential in `SUPABASE_ANON_KEY`, and do not add `NEXT_PUBLIC_` prefixes. The separate ingestion command still needs its own privileged configuration and explicit paid approval when used live; keyless public reads do not grant ingestion privileges.

With the existing six seeded fixtures and no published real events, the connected home page is expected to be empty. `/sample` remains usable with no database credentials or database connection. The ingestion migration is not required for read-only dashboard access, but remains necessary before running ingestion.

## Public-read rules

- Read only `events`. SQLite uses a server-only bounded query; Supabase uses a fresh anonymous client with session storage disabled. Never query or join `event_sources` or `search_runs` from a page.
- Select only the columns needed to validate and render cards. Raw source evidence, diagnostics, internal timestamps, and scoring implementation metadata are not passed into the card model.
- Filter to `publication_status = published` and `is_fixture = false`. Row-level security independently prevents anonymous and authenticated readers from reading drafts or archives, and denies writes.
- Show in-person or hybrid events in New York, NY, US, using `America/New_York`, starting from the request time up to (but not including) 30 days later. Cancelled events are excluded. Already-started and past events are excluded.
- On `/` and `/career`, require a validated career assessment and exclude closed registration; rank saved career scores highest first, then start time and stable ID. On `/events`, retain networking-score ranking, with null scores last and the same tie-breakers. Zero is a valid score, not an unknown value.
- Display at most 50 events. A 51st row is used only to indicate that the list is capped. There is no pagination in this increment.
- Disable caching and automatic database retries. Supabase reads have an eight-second timeout. SQLite uses a bounded lock wait and WAL concurrency. A new request sees database changes rather than a build-time snapshot.
- Validate returned rows and recheck visibility before creating public card objects. Malformed required fields produce a safe unavailable state. Blank optional text becomes unknown.

The fixture rows remain publicly readable under the existing database policy; they are explicitly excluded from the main application's query and defensive projection. `/sample` uses the original local fixture module, not those database rows.

## What the UI does and does not claim

Missing scores say “Not scored,” missing prices say “Price not listed,” and missing organizers/end times remain explicitly unknown. Known prices use integer minor units and their currency; only an explicit known zero is free. Blank recommendations do not become generated recommendations. Published events are not automatically considered newly discovered or independently verified.

The public `events.public_registration_url` field now carries only a selected canonical listing link, set through the separate [local review workflow](REVIEW-PUBLISH.md). The dashboard rejects noncanonical or unsupported URLs and never copies a link from private source records. Cards without an approved link still say “Registration link not available.” Sample cards never have links. Links open in a new tab with opener protection and no referrer. The public page has no publishing controls, admin interface, automatic scoring, or discovery scheduling.

## Verify

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:next
npm run test:next:runtime
npm run db:test:isolated
```

`test:next` checks the built sample HTML and confirms `/`, `/career`, and `/events` are not prerendered. `test:next:runtime` starts a production Next.js server and a synthetic database HTTP server on temporary loopback ports. It tests career homepage/alias parity and ranking, retained all-events access, privacy, configuration, edition-specific empty/error/recovery states, sample navigation, and loading-state streaming. It never uses the real database or a paid API, and closes both servers when finished. Run it from your regular Terminal if the sandbox blocks local listening ports.

The isolated database suite applies migrations and seeds to a disposable database and checks actual database permissions; it removes that database afterwards without modifying the normal one. See [the integration checkpoint](INTEGRATION-PROGRESS.md) for the verified results and environment limitations from this cycle.

## Next live-data step

Follow [the ingestion guide](INGESTION.md) only after choosing an API model, supplying credentials securely, and approving a separate small API budget. Verify three actual upcoming listings and repeat-run deduplication. Keep the imported events as drafts until their facts are reviewed and publication is explicitly authorized. This dashboard work is not evidence that the live ingestion gate has passed.
