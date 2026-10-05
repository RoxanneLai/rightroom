# First ingestion agent

## Status and scope

The implementation is a manually triggered ingestion command using **OpenRouter** and a local-only database. SQLite is the default; local Supabase remains an explicit option. New commands default to career discovery for product/technical-delivery events with a separate explainable career assessment. Explicit `--profile founder` retains NYC in-person/hybrid founder/investor discovery. Historical saved runs with no profile remain founder runs; no data is reinterpreted or migrated. Both profiles persist private drafts with provenance; neither publishes, registers, schedules work, or invents legacy scores. See [career discovery](CAREER-EVENTS.md).

**Live discovery, extraction, generalized schema repair, draft persistence, and repeat-run deduplication now work.** Fresh-window acceptance run `edc10f58-32cd-4ab6-9f50-4317358c5139` succeeded: it refreshed one exact Meetup source, wrote one private draft, and recorded no errors after a bounded repair converted an unfamiliar valid-JSON shape into one canonical candidate with zero scalar mismatches. Manual verification of that listing and an explicit publication decision remain human steps. Candidate-specific repair isolation still ensures that safe canonical siblings continue while unusable siblings remain source-only; invented repair values are never returned.

That acceptance used the historical hosted-fetch/report evidence path. New live commands now use independent bounded page capture and tool-free extraction, described below. The [October 1 career checkpoint](CAREER-EVENTS.md#earlier-live-checkpoint--october-1-2026) subsequently succeeded with one new private draft and an unchanged published event. The October 3 expansion pilot below wrote no drafts; after selection/quote fixes and full-workflow offline checks, the [October 5 expansion checkpoint](CAREER-EVENTS.md#current-live-checkpoint--october-5-2026) recovered one unlinked lead into a new draft with canonical extraction and no repair. The selection contract is now live-observed. This run did not exercise escape normalization or conditional repair, and neither checkpoint proves exhaustive discovery, current RSVP availability, calibrated relevance or production reliability.

### October 3 expansion follow-up

User-run attempt `b512af62-a2ac-42e2-8b0d-d4443b8af17d` used career/expand, three searches, limit three, and the exact window `2026-10-03T06:30:08.604Z` through `2026-10-17T06:30:08.604Z`. Five known sources were excluded without truncation; three new listing sources were captured. Both Luna/medium requests succeeded and all three extracted candidates were canonical, schema-valid and source-matched, with no repair request. The run finished partial: zero drafts, one `incomplete_event` and two `source_page_past` rejections. Provider-reported combined cost was $0.02757378, unverified.

Read-only inspection reproduced the failures from untruncated canonical scalar snapshots. The upcoming listing failed solely on an overescaped attendance-mode quote; two old Luma dates were correctly rejected. Research had discussed those listings as rejected/uncertain citations, but broad citation fallback promoted them into capture candidates. The bounded selection contract and quote rule below address these distinct issues. Offline checking against the saved snapshots now accepts the upcoming candidate without changing its original model evidence and still rejects both past candidates. The original narrative-only research response now fails selection rather than promoting its citations. This is not a fresh provider replay or permission to import/publish that candidate: actual model adherence to the new discovery contract needs a separately authorized live acceptance run.

## What happens in one run

Career research supports opt-in `--search-focus product` (one to three search slots) alongside default `balanced` (one to twelve). It reuses the three existing product-community/PM-practice families rather than the default interleaving with technology and finance. Focus is recorded in plans, both storage backends' search parameters and private run/research metadata; historical options without focus stay balanced. Founder mode rejects either focus flag. This changes research priorities, not candidate validation, scores, tools, retry limits or publication rules. Planned queries remain unverified execution. See [the free PM-focused preparation](PM-DISCOVERY-PREPARATION.md).

1. Validate the search dates and result limit. In live mode, reject a search start more than 15 minutes old before reading credentials, contacting the database, or making a paid request; then create a search-run record.
2. Build a bounded exclusion list with the selected discovery intent. Refresh excludes recently cancelled, unlinked sources; expansion additionally excludes sources linked to non-fixture events in the requested window. Keep cancelled exclusions first, cap the combined list at 50, and checkpoint counts/truncation and private URLs before research. If either lookup or the checkpoint fails, close the run before any paid research request.
3. Ask the configured model through OpenRouter's Chat Completions endpoint to research public listings using its `openrouter:web_search` server tool. The model controls its search queries; the tool uses Exa with explicit search/result bounds. It is instructed to seek multiple distinct listings, fill the requested limit when supported, and avoid the supplied excluded-source URLs.
   Verify reported search counts against the configured budget. When absent/null, require provider citations bounded to five per budgeted search and at least one supported listing URL. Founder defaults to three searches; career supports up to twelve. Request tool/result bounds remain enforced; missing executed queries/counters stay unknown.
4. Read the report's explicit `rightroom-discovery-v1` selection block, then intersect selected individual URLs with returned URL-citation annotations. `selected` and `needs_verification` entries may proceed to source capture; `rejected` entries and other background citations never fill candidate slots. The strict block allows only `version` and at most ten `listings`, each with `source_url` and `disposition`. Duplicate identities, unknown keys/statuses, malformed blocks and excess usable leads fail with `invalid_research_selection`, without another model request. Explicit empty/rejected-only selections skip capture and extraction. Historical numbered event sections remain supported, selecting one primary URL per section and stopping at the next heading. Unstructured narrative reports no longer fall back to all citations. Excluded canonical URLs, tracking aliases and alternate Meetup identities with the same event ID cannot become candidates. Cap retained candidates at the requested limit.
5. Save the research report and consulted URLs privately in the search run. Persist candidate sources before extraction.
6. Capture each selected public HTTPS listing directly with bounded time, body size, text size, DNS validation, and same-identity redirects. Keep source identity separate from the cited retrieval hostname, preserving `www` when supplied. Retain extracted page text privately in run metadata. A failed capture stays source-only and preserves earlier good evidence; if every capture fails, skip extraction. There is no hosted-fetch fallback or automatic retry. See [source evidence](SOURCE-EVIDENCE.md).
7. Make one tool-free structured-output request with the successfully captured pages, returning exactly one bounded verdict per supplied source. Founder candidates need positive founder-audience relevance; career candidates instead need supported product/technical-delivery relevance and keep founder-audience relevance unknown. The complete selected schema appears in prompts and `response_format`. Facts and exact quotes must be supported by that source's captured text. Discovery-report omissions do not invalidate supported page facts. Rejected conflicts/past/cancelled/virtual/insufficient listings carry allowlisted codes and no facts.
8. If the parsed response is valid JSON but has an unfamiliar outer structure or source-complete noncanonical candidates, make at most one tool-free repair request using the configured repair model. It receives only the bounded extraction JSON and expected URLs. For one source, the complete response is its evidence scope. For multiple sources, local code must first isolate exactly one unambiguous JSON subtree containing a verification verdict for every trusted URL; otherwise it fails before repair. The repaired batch must retain exact, unique trusted-source coverage. Each repaired sibling is applied only when it independently satisfies the canonical schema and merely rearranges scalars already present in its corresponding source scope. A scalar-changing or malformed sibling from a recognized candidate array reverts to its unchanged original; one from an unfamiliar wrapper becomes a source-only placeholder with no event facts. Safe repaired siblings continue. Malformed JSON, ambiguous or incomplete multi-source structures, and responses without an existing verification verdict fail closed. If no canonical original or fact-preserving repair remains usable, fail closed.
9. Require trusted, unique source coverage and reject reported tool use in captured-page extraction before any repair. Safe extraction diagnostics identify `fetch_verification: local_source_capture`; missing provider counters remain unknown. The legacy provider path used by historical replays without page snapshots retains its hosted-fetch count/verdict gates and is not a fallback for new live runs.
10. Validate title, time, profile relevance, city, format, window, and that the event starts after observation. Confirmed physical NYC events with date/clock time may default an unstated timezone, recorded separately with review cautions. Exact source-backed `ET`, `EST`, and `EDT` labels normalize to `America/New_York`; seasonal labels must match the event date, including a stated end. Original facts/quotes remain private and unchanged, with a separate `timezone_normalized_eastern` note and review warning. Unknown or ungrounded labels, conflicting zones/offsets and DST gaps/overlaps fail. Save drafts; retain rejected/incomplete sources with safe diagnostics.
11. Finish with counts, safe error codes, model usage when available, and a local recovery checkpoint.

The provider adapter never writes to the database. The selected repository owns transactional persistence: SQLite uses a local immediate transaction and Supabase uses `ingest_event_source`. Concurrent saves of the same provider URL or external ID reuse a source and event. Original `first_seen_at` and discovery-run attribution are retained.

### Evidence is not a page archive

New live runs store bounded, independently captured static page text as `source_page_text_v1`, separate from the model-generated discovery report. The private snapshot records sanitized retrieval/final URLs, actual capture time, HTTP status/content type, byte count, redirect count, and body/text hashes. Successful source `content_text` is that captured text; `raw_payload.source_page` holds its snapshot. Search-run metadata retains successful captures even when later extraction fails. This is not raw HTML, a browser-rendered archive, or proof of listing accuracy. The source's top-level `fetched_at` remains the evidence-observation timestamp; actual capture time and HTTP status live in the private snapshot, not a new top-level database field.

Historical runs still store model-generated reports with their original evidence kinds, including `model_web_search_report_with_source_fetch`. They are not relabeled as page captures. Historical report-based quote and hosted-fetch validation remain available for offline replay. New captured-page replays use the saved source text and fail closed when the snapshot is missing or invalid.

Review drafts against their original links before publishing. Capture failure and quote grounding are safeguards, not guarantees against model or listing errors. Search is not an exhaustive provider feed. Same-event deduplication across platforms and recurring-event identity remain future work.

Research and extraction must use the event date's explicitly stated year, never a current/search-window year, URL, or copyright footer. Extraction must reject an explicitly past page even if research rolled it forward. Local normalization also rejects a recognized English/ISO date year in the start-time quote that contradicts the NYC event year, using `source_page_conflict`. UTC timestamps are compared in NYC time across year boundaries. This narrow contradiction check does not parse arbitrary languages/date formats or independently authenticate the page; a consistently wrong report still needs source verification and human review.

Unknown registration is the extraction pair `{"value":null,"quote":null}`. The application displays it as `unknown`; a registration button alone is not evidence of available seats. Non-null registration values require supporting quotes, and a repair may not erase a non-null value or invent a missing quote to make an inconsistent pair valid.

Extraction and repair output schemas constrain `event_format.value` to `in-person`, `hybrid`, `virtual`, or null for both profiles. Historical runtime inputs remain string-valued for compatibility, but local eligibility still rejects virtual and unknown formats. Only the observed `in_person` spelling is mapped to `in-person`, after exact quote grounding; other labels are not guessed or case-folded. Private source evidence keeps the original value/quote and records `event_format_normalized_in_person` in normalization notes, with an operator-review warning. Model repair still may not change that scalar; this is a separate deterministic normalization step, not permission to invent physical attendance. See [the capture acceptance follow-up](SOURCE-EVIDENCE.md#format-label-acceptance-follow-up).

A second narrow compatibility rule handles one extra JSON escape layer on the exact fragment `eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode` (or the matching Mixed/Online mode for hybrid/virtual). It applies only to `event_format.quote`, only when the original quote equals that fragment's single JSON-string encoding, and only when the unescaped fragment occurs literally in this source's evidence. No fuzzy matching, generic unescaping, extra escape layers, other fields or mismatched attendance modes are accepted. Original model values/quotes remain unchanged in private evidence; `event_format_quote_json_escape_normalized` records the derived step and triggers an operator-review warning. Virtual events, past dates, bad locations and unsupported relevance still fail their usual gates. Quote presence is not semantic proof, and human approval remains required. This change is offline-verified; it does not retrospectively rewrite records or establish a new live acceptance result.

Official references: [OpenRouter server-side web search](https://openrouter.ai/docs/guides/features/server-tools/web-search), [OpenRouter server-side web fetch](https://openrouter.ai/docs/guides/features/server-tools/web-fetch), [OpenRouter reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [Supabase RPC](https://supabase.com/docs/reference/javascript/rpc). OpenRouter currently labels server tools beta; real-account behavior remains part of the live acceptance test.

### Safe structured-output diagnostics

Extraction and repair diagnostics include `structured_output` once strict JSON parsing is attempted. This records only fixed categories and booleans: valid object/array/scalar JSON, missing/empty content, a standalone code fence, mixed text, malformed object/array-like text, or other text. It also reports a leading byte-order mark, whether a standalone fence contains valid JSON, a structural incompleteness hint, and whether inspection reached its size limit. Research is not classified as JSON; null means parsing was not attempted or the historical diagnostic predates this field.

These fields appear in safe provider diagnostics, private run summaries/recovery checkpoints, run inspection, and offline capture-replay reports. They contain no response text, source content, arbitrary fence label, prompt, credential, reasoning trace, parser exception, or error position. Classification examines at most 65,536 characters; structural inspection stops at 128 nested containers. An inspection limit leaves completeness unknown rather than claiming provider truncation. Unclosed brackets or strings are a hint, not proof of why generation failed; an HTTP 200 with `finish_reason: stop` does not establish valid JSON.

The acceptance boundary is unchanged: only strict parsing of the complete response can reach schema validation or bounded repair. Valid JSON inside a code fence remains rejected as `invalid_extraction_json` or `invalid_repair_json`; the diagnostic probe never strips wrappers, extracts a guessed substring, corrects syntax, or triggers a paid call. A successfully parsed JSON value can still fail the separate candidate/schema gates.

These diagnostics cannot reconstruct earlier malformed completions whose text was not retained. In particular, career pilot `2585c355-1830-402d-8e7f-3a74c210afcc` establishes a parsing failure, not a specific fence/prose/truncation cause. Offline synthetic tests exercise the new classifications without contacting a model or changing an existing database. Any future live attempt still requires separate paid-call approval.

## Start safely: no-network plan

Install the checked-in dependencies first:

```bash
npm ci
npm run ingest -- --limit 3
```

Without `--live`, the command reads the non-secret model configuration and prints the selected primary and repair model/effort pairs, effective profile, proposed search, capture evidence kind/limits, tool-free extraction setting, and API bounds. It makes no network requests or database changes and never opens `OPENROUTER.key`. The default career search starts now and ends 30 days later; explicit `--profile founder` retains a 14-day default. Both keep three searches and a candidate cap of ten unless overridden. Supplying both date flags preserves that exact window for either profile. Run commands from the repository root.

Plan mode also does not create or open SQLite and does not read `DATABASE_BACKEND`, `SQLITE_DATABASE_PATH`, or Supabase credentials.

Career plans read `config/career.json` (or `--career-config`, which also works when `--profile` is omitted). Use `npm run ingest -- --limit 3` for a small free career plan; explicit `--profile career` remains valid. Use `npm run ingest -- --profile founder --limit 3` for the legacy plan without reading career configuration. Founder mode rejects `--career-config` and search budgets above three. Missing or invalid career configuration fails before key, database, or network access. Profile/version, planned queries, window/budget, canonical consulted URLs, and acceptance/rejection results are retained privately. Plans are not execution logs. Larger budgets can cost more and require separate live approval.

## Refresh versus expansion

The independent `--intent refresh|expand` option works with both profiles and storage backends. Omitted intent means **refresh**, including historical saved runs. No existing records are reinterpreted, copied, deleted, rescored, or published by selecting an intent.

```bash
# Free plans only; neither command opens a database or OPENROUTER.key.
npm run ingest -- --intent refresh --limit 3
npm run ingest -- --intent expand --limit 3
```

Refresh may revisit known events to recheck listings. Both intents retain the existing 90-day exclusion policy for unlinked sources whose last attempt rejected them as cancelled. Expansion additionally reads linked non-fixture sources whose event start is in `[from, to)`. Draft, published, and archived events all count as known; out-of-window events and fixtures do not. A failed refresh of a linked event does not make it new. Unlinked failures other than recent cancellations remain eligible so a later fix can recover them.

Each query reads at most 51 rows: 50 candidates plus one truncation sentinel. Cancellation candidates are ordered by latest attempt then source ID; linked candidates are ordered by source ID in both backends. Only supported canonical identities survive normalization. Cancelled exclusions take priority, followed by linked identities not already excluded, with a combined maximum of 50. Canonical/tracking/hostname aliases and platform external IDs are checked before the event limit and before page capture, even if the model ignores the exclusion instruction. There is no cross-platform semantic event matching.

Plans show intent, policy, cap, and **null** actual counts/truncation because plans never inspect storage. Live `search_runs.search_parameters` records the effective intent. Safe console/checkpoint summaries and `npm run ingest:inspect -- --run UUID` include `discovery_exclusions`: actual cancelled, linked, and total selected counts plus separate query/cap truncation flags. A flag is conservative: candidate rows may include unsupported or overlapping identities, and the unread tail is unknown. Counts describe the supplied exclusion list, not the total database population or number of executed searches. Historical inspection with no such metadata returns null, not invented zeros. The complete exclusion URLs remain private in run metadata, not in the safe counts.

The pre-research exclusion queries are not a transaction-wide snapshot of concurrent writers. Another run can link an event after selection; transactional source identity, deduplication, and reviewed/published-event protection remain the final safety boundary. Expansion favors drafts not already linked in this window, but cannot guarantee previously unseen sources, distinct cross-platform events, or a full candidate batch. Zero retained candidates is a successful empty result: no capture, extraction, repair, retry, or extra paid search follows. Search budgets and the two-normal-request/one-conditional-repair ceiling are unchanged. A live expansion still needs the existing credential file and paid-call opt-in, and requires a separately approved pilot.

The approved October 5 pilot supplied five untruncated exclusions (one cancelled lead, four linked sources), captured one previously unlinked source, and wrote one new private draft. Read-only backup comparison confirmed the exclusion set and unchanged prior events/publication history. Its valid manifest retained a `needs_verification` lead whose captured page supplied the missing facts. It made two model requests, no repair and no retry, with $0.02659782 provider-reported cost (unverified). This is a successful one-lead compatibility check, not evidence that expansion finds three distinct new events or reliably improves discovery diversity. Human review identified weak role-fit/networking quote semantics and host approval on a linked registration page; those limitations remain separate from schema validity. See the [current career checkpoint](CAREER-EVENTS.md#current-live-checkpoint--october-5-2026).

## Select the backend model and effort

The checked-in default is in `config/ingestion.json`:

```json
{
  "model": "openai/gpt-5.6-luna",
  "effort": "medium",
  "repair_model": "openai/gpt-5.6-luna",
  "repair_effort": "medium"
}
```

Luna at medium effort is the current working default based on its expected price/performance, not a claim that it is optimal or end-to-end verified. Set `model` to an explicit OpenRouter `vendor/model-id` whose endpoint supports reasoning, tool calling, and JSON-schema structured outputs. `effort` must be one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Model-specific support differs. OpenRouter may map an unsupported gateway effort to the nearest supported level, so comparisons must verify the exact model/effort pair in the current model catalog first. Requests require parameter support and disable provider fallbacks; an incompatible model fails rather than silently switching models or dropping required parameters.

The repair default also uses Luna at medium effort for one constrained JSON transformation. Qwen 3.5 27B failed closed at both `none` and `low` effort by returning noncanonical aliases unchanged; the low-effort attempt also cost more than the earlier Luna extraction. Muse Spark 1.3 Contributor advertised the required parameters and was visible to the active key, but OpenRouter denied all three isolated repair attempts before contacting its sole endpoint. The final metadata-enabled attempt reported one available endpoint, zero selected endpoints, and router attempt zero, classified safely as model access. Neither experimental model is therefore a working default. The Luna repair-only check completed in 9.822 seconds for a provider-reported $0.00208335. It transformed all three source-complete candidates into the canonical schema, retained two usable events and one fact-free `source_fetch_failed` verdict, and passed the local source-coverage and scalar-preservation gates. The repair request has no tools and does not receive the research report or fetched page content. It can now handle an unfamiliar valid-JSON wrapper only after local code establishes a safe per-source evidence scope. Local scalar-preservation checks prevent the repair model from adding a title, date, venue, price, quote, verdict, or other fact that was absent from that source scope. Repairs are never retried; unsafe siblings revert to their unchanged original inputs while independently safe repaired siblings may continue through canonical event validation.

Override either setting for one run with `--model` and `--effort`, or select another non-secret JSON configuration with `--config`. When testing another model, normally specify both overrides:

```bash
npm run ingest -- --model openai/gpt-oss-20b --effort low --limit 3
npm run ingest -- --config config/ingestion.json --model deepseek/deepseek-v4-flash-0731 --effort high --limit 3
npm run ingest -- --repair-model openai/gpt-5.6-luna --repair-effort medium --limit 3
```

Precedence is independently **CLI override over the selected configuration** for all four settings. Research and extraction use the effective primary pair; repair uses the effective repair pair. Every request sends `reasoning: { effort, exclude: true }`. The model may reason internally, but no reasoning trace is requested or retained. Reasoning tokens count as billable output tokens; an allowlisted provider-reported reasoning-token count is retained when valid and otherwise remains `null`. `OPENAI_MODEL`, effort environment variables, and other model environment variables are not used. The configuration must exist and contain exactly valid `model`, `effort`, `repair_model`, and `repair_effort` fields, even when overriding a value. Missing/malformed files and duplicate CLI flags stop before database, key, or API access. Auto-router model IDs and the deprecated `:online` suffix are rejected, so search stays in the explicitly bounded server tool.

Configuration paths are relative to the working directory (absolute paths also work). The credential path is always `./OPENROUTER.key`, not relative to a custom config file. Do not put keys, a custom API URL, or a paid opt-in into the JSON file.

## Supply the credential file

Create **`OPENROUTER.key` in the repository root**, containing only the bare OpenRouter API key on one line. No JSON, quotes, `Bearer` prefix, or variable assignment. Leading/trailing whitespace and a final newline are accepted. The loader requires a regular, non-symlink file of at most 4 KiB; missing, unreadable, empty or malformed files produce safe errors without printing contents.

`OPENROUTER.key` is ignored by Git. Keep it outside `public/` and protect it with restrictive local permissions, such as `chmod 600 OPENROUTER.key`. Never paste the key into chat, source code, CLI arguments or reports. The program reads it only in explicitly enabled live mode, after validating the paid opt-in and local database settings. Neither the dashboard nor offline tests need the real key file. There is no fallback to an OpenAI key or environment API key.

For repeatable tests, supply both ISO timestamps, including an explicit offset or `Z`:

```bash
npm run ingest -- --from 2026-09-02T00:00:00-04:00 --to 2026-09-16T00:00:00-04:00 --limit 3
```

Replace these example dates when they are no longer current. The start is inclusive and the end is exclusive.

## Prepare live mode

1. Review the plan's primary and repair model/effort pairs and agree on a small **separate OpenRouter testing budget**, including hosted search, reasoning output, optional repair, and other model usage. Supplying a key does not itself authorize a live run.
2. Choose the database. The default SQLite file is initialized automatically and needs no credentials. If you override `SQLITE_DATABASE_PATH`, use the same value for ingestion, inspection, review, and the dashboard.
3. Supply `OPENROUTER.key` as described above and enable paid calls in the terminal where the command will run:

| Variable                       | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `FOUNDER_RADAR_ALLOW_PAID_API` | Must be exactly `1` in addition to the `--live` flag |
| `SQLITE_DATABASE_PATH`         | Optional override for the persistent local file      |

To retain the Supabase workflow, set `DATABASE_BACKEND=supabase`, start Docker and the local stack, apply migrations, and supply the local `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Only loopback HTTP database URLs with an explicit port are accepted. See [STORAGE.md](STORAGE.md). The command does **not** automatically load `.env` or `.env.local`. Do not put credentials in source files, command-line arguments, progress notes, or chat.

4. After the budget and credentials are ready, run the same bounded command with `--live`:

```bash
npm run ingest -- --live --limit 3
```

Resolve or copy the exact date window immediately before starting live mode. A live `--from` timestamp may be at most 15 minutes old; a saved plan pasted days later is rejected before credentials, database access, or paid API calls. The same primary and repair defaults and independent overrides apply in plan and live modes. No live run is launched by the test commands or by viewing the dashboard.

## Bounds and failure behavior

| Limit                      | Current value                                                                    |
| -------------------------- | -------------------------------------------------------------------------------- |
| Retained candidate sources | 1–10; default 10                                                                 |
| Search interval            | More than zero, at most 31 days                                                  |
| Live start freshness       | No more than 15 minutes before command execution                                 |
| OpenRouter API requests    | One research, one extraction if captures succeed, at most one conditional repair |
| Hosted search-tool calls   | Default 3; career 1–12, founder 1–3, bounded by `max_tool_calls` and `max_uses`  |
| Direct source capture      | At most 10 listings; 20 seconds each including redirects                         |
| Capture redirects          | At most 2, same canonical listing identity only                                  |
| Capture body / text        | 1 MiB response; 16,000 text characters/page; 80,000 total                        |
| Hosted extraction fetches  | None in new live runs; legacy replay retains old bounds                          |
| Search results             | At most 5 per search, 15 total                                                   |
| Search-result content      | At most 2,000 characters per result                                              |
| Research output tokens     | At most 6,000                                                                    |
| Extraction output tokens   | At most 12,000                                                                   |
| Repair input text          | At most 60,000 characters                                                        |
| Repair output tokens       | At most 6,000                                                                    |
| Research text accepted     | At most 40,000 characters                                                        |
| API response body          | At most 1 MiB before JSON parsing                                                |
| Provider request timeout   | 120 seconds                                                                      |
| Database request timeout   | 15 seconds                                                                       |
| Run cancellation deadline  | 5 minutes, followed by bounded database finalization                             |
| Automatic API retries      | None, including quota/rate errors                                                |

These are work/request bounds, **not a dollar-accurate billing cap**. OpenRouter may perform several internal model turns while researching. Input, model output and hosted search can be billed, even when validation later rejects the result. Captured text increases extraction input. Check current model/tool pricing and account billing controls before enabling live calls. Offline transport tests verify requested limits, but live enforcement still needs confirmation. The adapter rejects reported zero/invalid/over-budget search counts; missing counts require bounded citation evidence rather than an invented count. Exa remains fixed for search. New source capture makes no LLM call; extraction is tool-free. No credit exhaustion, rate limit or other failure is automatically retried.

Model requests use only the fixed `https://openrouter.ai/api/v1/chat/completions` endpoint; redirects are rejected. New live runs separately retrieve annotated, report-selected public listing URLs restricted to Luma, Meetup, Eventbrite, and the organizer registry. Every connection pins a validated public DNS address and verifies TLS; redirects must retain the exact canonical listing identity. No credentials, cookies, proxy agent, or arbitrary private query values are forwarded. Reports/pages are untrusted data, never instructions to change database operations or publication status. Historical replay keeps the old hosted-fetch behavior, without real network access.

Failed or discovery-only observations preserve earlier successful content, retrieval time, and event links. New valid observations update draft facts. Published, archived, and fixture events are not rewritten by the agent. An older observation cannot overwrite a newer one. Conflicting URL/external-ID identities are rejected for review, not automatically merged.

`last_attempt_at` and `last_attempt_error` are distinct from the last successful evidence snapshot. New runs are labeled `openrouter-web-search`, with both selected model/effort pairs saved in `search_parameters` before paid requests. Per-request requested model and effort, returned model, response ID, input/output/reasoning/total token usage, provider-reported cost when present, report, consulted URLs, and summary live in private `search_runs.metadata`. Repair-attempt metadata is nested under the extraction observation with explicit `repair_attempted` and `repair_applied` flags. Missing or malformed reasoning-token usage remains `null`; zero is retained only when explicitly reported. Provider usage and cost are unverified diagnostics. The source stores the latest successful candidate snapshot; it is not an append-only observation history.

New per-source normalization failures also retain `search_runs.metadata.candidate_failures`, separate from the source's good snapshot. Each entry records source ID, observation time, safe error code, candidate count, and an allowlisted flat projection of canonical fact values/quotes and their types. Missing, null, wrong-type, and truncated fields remain distinguishable. Unknown provider keys, headers, raw errors, reasoning/trace fields, and arbitrary nested objects are not copied. There are at most ten entries per run; each captures at most 256 fields, ten items per array, 4,000 characters per string, and 12,000 total string characters. Duplicate/missing candidates retain counts only, not an ambiguously associated payload. Truncation is explicit; snapshots are diagnostic evidence, not automatically usable recovery input.

These values/quotes remain privileged database metadata in both backends, never console/progress summaries, the safe run inspector, or the public dashboard. Treat them and database backups as private untrusted data. If exporting them for diagnosis, use an owner-only file under ignored `codex-tmp/`, never a public issue or Git commit. Historical failures without these snapshots cannot be reconstructed retroactively, and failures before per-source normalization do not retain a candidate. A failed refresh still preserves successful source content and event linkage.

## Verification without paid calls

```bash
npm run lint
npm run typecheck
npm test
npm run db:test:isolated
npm run build
npm run test:next
```

`db:test:isolated` requires the existing local Supabase Docker container. It creates a uniquely named disposable database, applies all migrations and fixture seeds, runs every pgTAP contract plus review/concurrency tests, and drops only that disposable database afterward. It does not reset the user's normal database. If forcibly interrupted, it may leave a database beginning with `fr_review_test_`; inspect before removing it.

### SQLite-default checkpoint — September 26, 2026

Formatting, lint, TypeScript, and all 112 normal offline tests pass. The optional Supabase suite also passes: 145 pgTAP assertions plus five isolated runner tests, including the real Supabase review CLI. The production build, two built-output checks, seven runtime dashboard checks, and a credential-free fresh SQLite production-server smoke check pass. The build ran from an ignored clean copy because the app sandbox could not remove an older `.next/diagnostics` directory in the working checkout; that filesystem limitation is unrelated to the source or build output. No paid request or existing database write was made.

### OpenRouter implementation checkpoint — September 2, 2026

Lint, TypeScript, formatting, all 71 offline tests (including 39 ingestion tests), and the isolated database suite (145 assertions plus five runner tests) passed. Offline tests ran in a disposable Docker container with networking disabled because host-sandbox cleanup of test directories failed with `EPERM`, even with approval. All credentials and API responses in those tests were synthetic. The production build and both built-output tests passed in a credential-free copy under `codex-tmp/openrouter-release.EY061I`, leaving the active dashboard build untouched; Next.js reported the expected nested-workspace lockfile warning.

The unused direct OpenAI SDK was removed from the dependency manifest, lockfile, and installed dependencies; its earlier adapter/tests remain recoverable in Git history. The installed cleanup was completed in the regular Terminal and verified with `npm ls openai --depth=0`. No real key was read, no live API request was made, and no normal database events were collected or published for this implementation.

Generated TypeScript types are in `lib/database.types.ts`. They were generated with Supabase postgres-meta from the migrated schema. After applying future migrations, `npm run db:types -- --schema public` prints fresh types; save and format them before typechecking.

## Inspect and recover

The command prints a safe final JSON summary and saves milestone snapshots to ignored `codex-tmp/ingestion-<run-id>.json`, creating new files with owner-only permissions. Snapshots contain counts, diagnostic codes, and allowlisted provider diagnostics, not credentials or source content. `events_written` counts inserted or refreshed drafts, not necessarily newly created events. `sources_unlinked` counts persisted candidates still lacking an event link.

Inspect any saved local run without reading a key, making a paid request, or writing to the database:

```bash
npm run ingest:inspect -- --run RUN_UUID
```

An operating-system kill or sandbox interruption can prevent finalization and leave a run marked `running`. Confirm that its original process has stopped and inspect its provider usage first. Then use the explicit recovery workflow:

```bash
npm run ingest:recover -- list
npm run ingest:recover -- preview --run RUN_UUID
npm run ingest:recover -- cancel --run RUN_UUID --revision PREVIEW_REVISION --approve
```

List and preview are read-only. Cancellation performs one local revision-checked update only when the selected run is still `running` and unchanged since preview. It preserves the run, sources, events, metadata, and prior error text; sets status to `cancelled`; and adds a bounded `run_cancelled` operator-recovery audit marker. It never retries provider work. SQLite is the default, while explicit Supabase mode retains the local-Docker-only boundary. Do not use recovery to stop an active process.

The inspector reads the selected backend and reports the run's parameters, safe provider diagnostics, provider-reported usage totals, and current identities/linkage for at most 50 sources. SQLite needs no Docker; Supabase inspection uses a read-only local Docker transaction. It never returns research text, source content, raw payloads, credentials, prompts, or reasoning traces. A source touched by a later run reflects its current linkage and last-attempt state, not a historical snapshot.

## Deterministic end-to-end acceptance

`npm run test:acceptance:offline` exercises discovery selection through independent synthetic-page capture, real temporary SQLite persistence, safe inspection, revision-bound review, and published-only dashboard reads. It includes fact-preserving bounded repair and failed-refresh protection, blocks real network transports, reads no API key, and changes no existing database. It is also included in `npm test`. See the [offline acceptance guide](OFFLINE-ACCEPTANCE.md) for cases and limitations; this does not replace a separately authorized live discovery check.

## Evaluate historical quality offline

Use the read-only SQLite evaluator before making another round of prompt, extraction, or model changes:

```bash
DATABASE_BACKEND=sqlite \
SQLITE_DATABASE_PATH=data/imported-founder-radar.sqlite \
npm run ingest:evaluate -- run
```

It reports historical and latest-five-terminal-run discovery fill, usable draft writes, deterministic loss categories, repair dependence, provider-reported tokens/cost, and current linkage state. It reads only allowlisted summary fields and optional ignored checkpoints, then writes an owner-only aggregate report to `codex-tmp/ingestion-quality-report.json`. No run IDs, source URLs, event facts, research text, raw errors, or credentials enter that report. It makes no network requests, paid calls, database writes, or publication changes. See the [evaluation guide](INGESTION-EVALUATION.md) for definitions, limitations, and the current evidence-based priorities.

Preserved private provider responses can be checked against the current adapter with `npm run ingest:replay -- run --manifest codex-tmp/capture-replay-manifest.json`. The command uses the selected SQLite history only for private run context, opens it read-only, substitutes local captures for provider responses, and emits an owner-only aggregate report. It reads no key and makes no network requests, paid calls, database writes, or publication changes. The manifest records whether each capture came from the original failure or from a later diagnostic so the output does not overstate compatibility coverage. See the [evaluation guide](INGESTION-EVALUATION.md#replay-preserved-responses-offline) for the manifest format.

### Safe diagnostics for rejected responses

Final normalization schema failures preserve `invalid_candidate` and append `candidate_validation_failures` to summaries/metadata: persisted source ID, fixed error code, at most 32 canonical field/reason pairs, and a truncation flag. SQLite and Supabase inspection revalidate them and tolerate historical absence. Unknown property names, rejected values, quotes, raw validation messages, and raw errors never appear. These describe what normalization actually received, including original candidates retained after failed repair; they cannot reconstruct discarded responses. Structural repair failures preserve valid originals, while auth/quota/infrastructure failures still stop the run.

`provider_diagnostics` in the summary (also saved in private `search_runs.metadata.summary`) contains at most three request snapshots per provider instance: research, extraction, and an optional repair. Each identifies its phase, requested model and effort, HTTP status, bounded response ID and returned model identifier, known finish reason, search/fetch counts, token usage and provider-reported cost when available. For a denied request, it also retains an allowlisted access category and bounded router attempt, endpoint, selected-endpoint, and guardrail-stage counts when OpenRouter reports them. Citation/tool-call counts, extraction candidate count and format, schema-valid candidate count, distinct expected-source matches, duplicate/untrusted source counts, repair-validation stage, and content length describe response structure without saving response text, URLs, prompts, headers, router-pipeline details, tool arguments, fetched content, reasoning traces, or raw errors. When scalar preservation fails, diagnostics also retain the total mismatch count and at most 32 canonical candidate field paths, such as `candidates[0].venue_name.value`; they never retain the original or repaired values. A completed scalar check with no mismatch records zero and an empty path list, while a check that was not reached remains `null`. Reflected API credentials and key-like identifiers are excluded.

Diagnostics are captured before response validation and included in the final recovery snapshot even when research, extraction, or database finalization fails. A response ID or cost is retained only if actually returned and safely parsed; network errors, non-JSON or oversized responses, and non-success HTTP responses may have no such details. Missing or invalid numbers stay `null`, never zero. These figures are provider reports, not independently verified billing totals.

- `search_usage_missing`: the documented search counter is absent/null and no usable provider citations were returned.
- `search_not_performed`: the counter explicitly reports zero searches.
- Invalid counters still fail response validation; diagnostics mark `search_usage` as `invalid` when a malformed counter is present.
- `source_fetch_usage_missing`: extraction omitted its fetch counter and did not return exact unique verdict coverage for every source.
- `source_fetch_incomplete` / `source_fetch_limit_exceeded`: the reported fetch count did not equal the number of selected listings.

These errors stop extraction and event creation. Inspect diagnostics and account usage before authorizing another paid request. Old failed run records remain unchanged; neither diagnostics nor metadata can reconstruct an earlier discarded research report.

The diagnostic and source-fetch gates pass lint, TypeScript, and the full offline ingestion, unit, dashboard, and review suites, including missing/zero/invalid tool usage, exact candidate-count enforcement, rejected-response cost retention, credential exclusion, and recovery after failed extraction or finalization. No paid retry was performed as part of these fixes.

### Compatibility when Chat Completions omits the search counter

OpenRouter documents `usage.server_tool_use.web_search_requests`, but the second approved Luna response omitted it. Missing is not zero. The adapter now permits two explicit verification paths:

- `search_verification: "usage_counter"`: the response reports between one and three searches. No metadata request is needed.
- `search_verification: "bounded_citations"`: the counter is missing/null and citations are bounded to five times the configured search budget (default 15, career maximum 60). At least one must canonicalize to a supported individual listing, including the conservative organizer registry. Other citations do not become candidates. Plain report text alone and excessive/unusable citation sets fail before extraction.

The fallback records `search_usage: "missing"` and `search_tool_calls: null`; it **does not infer query counts from citations, results, or price**. The three-search request limits, two primary requests, optional tool-free repair, extraction schema, source allowlist, draft-only writes, and manual publication requirement remain unchanged. This replaces mandatory query-count reporting with bounded, provider-supplied search evidence when that reporting is unavailable; it is not an independent audit of how many searches the server executed.

The compatibility change is covered by offline regression tests for missing counters, bounded citations, invalid/unsupported citations, excessive results, unchanged API limits, and draft-only persistence. The existing Luna response has exactly the evidence shape this fallback accepts. An explicitly approved end-to-end live check is still needed before claiming live compatibility.

The first end-to-end Luna run after enabling bounded citations successfully persisted three source observations but wrote no event drafts. Inspection found that citation order had selected one background URL absent from the three-event report. Source selection now intersects annotated listing URLs with URLs in the report and preserves report order.

The next run returned all candidates, exposing two further issues: the report said local times lacked an explicit timezone, so extraction left every timestamp null; and two platforms for one event consumed two source slots. Research now requests exactly one primary cited listing in each numbered event section, and source selection enforces one primary listing per section. Extraction applies an explicit ingestion policy: a stated clock time for a verified physical NYC venue is interpreted as `America/New_York`, with the date-correct offset. It still cannot invent a missing date, clock time, or NYC venue, and every result remains a draft requiring review.

The replay after that correction wrote three drafts with no ingestion errors. Independent source review accepted Founders Live NYC and Taco Tech Tuesday, but rejected NYC Startup Founders & Investors Networking Night because the current Meetup page showed September 2 rather than the report's September 9. Extraction now performs bounded hosted fetches of all selected pages and must return a fact-free rejection verdict for any listing whose current core facts conflict with the report.

The first source-fetch replay returned a normal HTTP 200 response with 19,705 tokens and a reported cost of $0.00672044, but Chat Completions omitted `usage.server_tool_use.web_fetch_requests`. The response was discarded before parsing and no event was refreshed. The compatibility path now requires `tool_choice: required`, one allowed fetch slot per source, and a strict response containing each supplied canonical URL exactly once with either a verified verdict or an allowlisted rejection reason. Rejected verdicts must carry no facts. A missing counter with partial, duplicate, invented, or malformed coverage still fails closed; an explicit zero or mismatched counter never uses the fallback.

The next two compatibility replays also returned HTTP 200 without a fetch counter, but their parsed JSON did not expose the expected three-item `candidates` array. Both were rejected as `invalid_extraction_shape` before validation or event writes, at provider-reported costs of $0.00707632 and $0.00630341. The structured-output schema is generated for each request with its candidate array fixed to the exact selected-source count. A contradictory legacy instruction to omit non-event candidates was removed; every supplied source must instead receive a fact-free rejection. Because OpenRouter server tools are beta and these observed responses did not honor the requested envelope, the local parser narrowly accepts the required object, the same array under the schema name, a direct candidate array, or one JSON-encoded copy of those forms. It still requires the exact count, strict candidate schema, canonical source set, unique coverage, and safe verdict rules. Diagnostics record only the envelope category and bounded candidate count when readable, not candidate content.

A later Luna capture showed an exact three-item direct array with the correct unique source set but an older flat fact/quote wire format. The compatibility adapter accepts only that observed exact-key shape, converts its separate fact and quote fields to the canonical nested representation, maps the observed `failed_fetch` label to `source_fetch_failed`, and leaves the absent address unknown. Unknown keys, inconsistent rejected verdicts, unsupported reason labels, and every existing canonical semantic check still fail closed. Diagnostics record whether canonical, legacy-flat, mixed, or invalid candidate formatting was observed without retaining candidate values.

The September 24 extraction-only diagnostic exposed a second exact flat shape using `venue` instead of `venue_name`, `relevant_to_founders` with a separate `relevance_quote`, and the rejection label `cancelled`. A strict adapter accepts only that full observed key set, maps those field aliases, and converts `cancelled` to canonical `source_page_cancelled`. Rejected candidates must still be fact-free, verified relevance must still be explicit, extra keys still fail, and the transformed candidate must pass the complete canonical schema. The known rejection mapping is also allowed through scalar-preservation checks when repair is otherwise required; no event fact alias is allowlisted.

A subsequent Luna response used the same nested fact objects as the canonical schema but legacy names for organizer, venue, and founder relevance. Its relevance value was explanatory text rather than a Boolean. A second exact-key adapter maps non-null relevance evidence to `true`, preserves its supporting quote, maps the renamed fields, and leaves the absent address unknown. The transformed result must still pass the full canonical schema and source-coverage checks. Diagnostics identify this form as `legacy_nested`; no candidate values are retained in safe diagnostics.

Other parsed variants are eligible for one repair request only when their candidate count and exact unique canonical source URLs already match the supplied sources. The configured repair model receives that candidate JSON and the expected URLs, with no search/fetch tools and no report or page content. Exact unique trusted-source coverage remains mandatory. Each canonical repaired sibling is accepted only when every non-null scalar already occurred in its corresponding original candidate, apart from the allowlisted legacy reason mappings. A sibling with any changed scalar or invalid format is discarded and replaced by its unchanged original; fact-preserving repaired siblings continue and the result records `accepted_partial`. Invalid JSON, no usable original or repaired sibling, partial/duplicate/untrusted coverage, explicit fetch-count failures, tool use, or a wholly noncanonical result fail without a second repair.

### Run statuses

- `succeeded`: the bounded run completed without recorded errors; it may legitimately find zero events.
- `partial`: at least one source was saved, but some extraction, validation, or other step failed.
- `failed`: the run could not persist candidates.
- `cancelled`: SIGINT/SIGTERM or the deadline stopped the run.
- `running`: a checkpoint, or a database run interrupted before finalization.

Only `succeeded` exits with code 0. A killed process, power loss, or database outage may leave a run marked `running`; no program can guarantee cleanup after a hard kill. Preserve that record and its local checkpoint. Confirm the original process has stopped, inspect the saved counts/errors, then start a new bounded run. Repeated source ingestion is safe. Do not blindly replay a paid request after an ambiguous timeout; inspect its API usage first.

Common codes:

| Code                                                       | Next action                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `paid_api_not_enabled`                                     | Expected safety gate; approve budget before setting the opt-in                                         |
| `stale_live_window`                                        | Resolve a new current window immediately before live execution                                         |
| `missing_ingestion_environment`                            | Supply the required server-side variables                                                              |
| `invalid_ingestion_config`                                 | Check all four model/effort fields and their explicit OpenRouter model IDs                             |
| `openrouter_key_file_unavailable`                          | Supply a readable, regular `OPENROUTER.key` in the working directory, at most 4 KiB                    |
| `invalid_openrouter_key_file`                              | Use one bare key, without JSON, quotes or a `Bearer` prefix                                            |
| `provider_authentication_failed`                           | OpenRouter returned 401; check the credential locally and never paste it into diagnostics              |
| `provider_access_denied`                                   | OpenRouter returned 403; inspect the safe access category and router counts before another attempt     |
| `search_usage_missing`                                     | Search execution is unknown; inspect safe diagnostics and account usage before another paid attempt    |
| `invalid_search_citation` / `search_result_limit_exceeded` | Provider citations were unsupported or excessive; stop before extraction                               |
| `search_not_performed` / `search_tool_limit_exceeded`      | Zero or excessive searches were reported; inspect model/tool compatibility before another paid attempt |
| `source_fetch_usage_missing`                               | Counter and exact source-verdict coverage are both missing; stop before accepting candidates           |
| `source_fetch_incomplete` / `source_fetch_limit_exceeded`  | Fetch count did not match selected listings; leave sources unlinked and inspect compatibility          |
| `invalid_repair_json` / `invalid_repair_output`            | Repair failed and no original or fact-preserving sibling could safely continue; do not retry           |
| `repair_input_too_large` / `unexpected_repair_tools`       | The candidate blob exceeded its bound or repair reported tool use; inspect compatibility               |
| `provider_diagnostics_unavailable`                         | The diagnostic snapshot could not be read; inspect the run's other safe errors before retrying         |
| `invalid_database_configuration`                           | Select `sqlite` or `supabase` and provide a valid SQLite path                                          |
| `local_database_required`                                  | Supabase mode accepts only the local stack, not a hosted project                                       |
| `ingestion_migration_required`                             | Apply the pending local migration                                                                      |
| `ingestion_preflight_failed`                               | Check the local stack, service-role access, and pending migration before any API spend                 |
| `source_exclusion_read_failed`                             | Check local source-read access; the run stops before research rather than omitting known cancellations |
| `provider_quota_or_rate_limit`                             | Stop; inspect API quota/billing/rate limits before another paid run                                    |
| `provider_incomplete` / `provider_request_failed`          | Inspect API usage; do not automatically retry                                                          |
| `incomplete_event` / `candidate_missing`                   | Inspect the private source/research report; leave the source unlinked                                  |
| `event_already_started`                                    | Leave the source unlinked; do not create or refresh a past-event draft                                 |
| `run_finish_failed`                                        | Use the local checkpoint; the database run may still say running                                       |
| `progress_write_failed`                                    | Local recovery-file write failed; inspect the database summary                                         |

Requests opt into OpenRouter router metadata so a denied request can be distinguished as a guardrail, data-policy, geographic, model-access, account-access, or unknown failure. Diagnostics retain only that category and bounded attempt/endpoint/stage counts. Provider messages, pipeline details, headers, credentials, prompts, source content, and reasoning traces are never stored or printed. A router attempt of zero means OpenRouter did not reach a model provider; it does not by itself identify which access policy denied the request.

## Live source-verification acceptance gate

The isolated repair checkpoint and fresh end-to-end implementation gate are complete. The historical sequence below records how the system reached that checkpoint; manual listing verification, publication approval, and broader discovery-quality evaluation remain:

- The September 8–22 run `a1344244-a8ee-4361-bc79-cb0ada11b150` succeeded with two newly discovered Meetup sources, two event drafts, no unlinked sources, and no errors.
- Research used bounded provider citations. Extraction used exact required-tool/source coverage because OpenRouter omitted the fetch counter, then one accepted repair produced two canonical candidates.
- Both original Meetup listings matched the stored titles, dates, times, NYC venue, and founder/investor relevance. Organizer, price, and registration status stayed unknown rather than being inferred. The secondary Eventbrite ticket pages rate-limited independent inspection.
- Both records are nonfixture drafts with source evidence. One began at 7:00 p.m. on September 8 and was persisted about four minutes after it started because the explicitly selected window began at midnight; it should not be published. The September 21 event remained upcoming at review time.
- The three model requests reported $0.03188156 combined cost, including the $0.00172905 repair. Search count and any separate hosted-search cost remain unknown because OpenRouter omitted the search-usage counter.
- Cleanup complete: the already-started event was archived with its source evidence intact, the upcoming event's operator preview had no blockers, and both sandbox-interrupted zero-source runs were marked cancelled with `run_cancelled` audit summaries.
- Repeat run `100aaf50-3dd7-4ff0-ba9d-58b0a5440983` rediscovered the same two URLs, created zero sources, updated both existing source rows, and created no duplicate events. Each URL still has exactly one source row linked to its original event.
- The repeat finished `partial` because Luna changed both candidate relevance verdicts to `false`, producing `irrelevant_event`. The prior event links and successful evidence timestamps were retained, the archived event remained archived, and the upcoming event remained a draft. This validates the failure-preservation boundary while exposing relevance consistency as the next quality issue.
- The repeat's three model requests reported $0.03162429 combined cost. Search count and any separate hosted-search cost remain unknown because OpenRouter again omitted its search-usage counter.
- The provider-facing schema now permits only explicit `true` or unknown relevance, and local validation requires every verified candidate to contain `true` plus a nonblank supporting quote. A model that cannot confirm relevance must return a fact-free `source_evidence_insufficient` rejection. The complete 97-test offline suite passes with this rule.
- Controlled refresh `c17329a9-62b8-4ec0-8e88-2cb8b27de053` used the same September 8–22 window and limit of three. It found the two existing Meetup URLs plus one new Luma URL. Luna's repair returned exact source coverage with two schema-valid candidates and one malformed candidate, so the run failed closed with `invalid_repair_output` and wrote no events.
- The two existing source/event identities, September 8 evidence snapshots, archived/draft publication states, and unpublished status were preserved. The new Luma source remains unlinked. All three source rows record only the failed refresh attempt.
- The refresh's three model requests reported $0.03492910 combined cost. Search count and any separate hosted-search cost remain unknown because OpenRouter again omitted its search-usage counter.
- Per-candidate repair isolation is implemented offline. A regression case accepts an exact two-source repair with one valid and one malformed sibling, writes only the valid draft, leaves the malformed source unlinked with `invalid_candidate`, and records `accepted_partial`. Repairs with no valid candidates, invented facts, duplicate/missing/untrusted URLs, or tool use still fail closed. The complete 97-test offline suite passes.
- Run `103b9926-addc-438e-b444-144ca09a98f7` was executed on September 24 with a September 14–28 window prepared ten days earlier. It discovered two new sources, wrote one event, left one source unlinked with `source_evidence_insufficient`, and reported $0.03148083 in combined model cost. Search count and any separate hosted-search cost remain unknown.
- The repair was fully `accepted` with two canonical candidates, so this run did not exercise the new `accepted_partial` path. The Eventbrite event began on September 15, review correctly blocked it from the upcoming feed, and it is now archived with evidence intact. The September 28 Meetup page later showed sufficient public date, venue, and founder/investor evidence, making its fact-free rejection a safe false negative rather than a false publication.
- Live mode now rejects a search start more than 15 minutes old before reading credentials, database access, or paid requests. Normalization also rejects an event at or before the run's actual observation time. These guards are covered offline without weakening plan or replay workflows.
- Fresh-window run `c95f5aa3-0527-4f47-8a98-5c4c58e4761e` was executed from `main` on September 24 with a September 24–October 8 window and limit of three. It discovered and stored three new sources, wrote no events, and left all three unlinked after repair produced canonical coverage but failed scalar preservation. The three requests reported $0.03486978 combined model cost; no retry was made.
- Manual inspection confirmed one selected Meetup listing was cancelled and another was a relevant, in-person event still upcoming at execution time; Eventbrite rate-limited independent inspection of the third listing. The run therefore passed the safety boundary but not the usefulness/reliability gate.
- One explicitly approved extraction-only diagnostic reused the preserved research with no searches or database writes. Its two requests cost a provider-reported $0.01059339 and reproduced one mismatch path: `candidates[0].source_verification.reason`. Private owner-only comparison showed the extraction label `cancelled` and canonical repair label `source_page_cancelled`; no event fact changed.
- The exact captured extraction now validates offline through the narrow deterministic adapter without a repair request: all three sources retain exact coverage, the cancelled source is rejected, and the other two candidates pass normal draft validation. The capture validation made zero paid requests and zero database writes.
- Offline import run `2fbb2513-020f-44b9-858e-98cedbc5015f` replayed that captured extraction through the normal repository and current-time validation. It updated all three source rows, wrote two event drafts, and left the cancelled Meetup source unlinked with `source_page_cancelled`. It made zero paid requests and published nothing.
- Read-only operator previews found no workflow blockers after selecting each canonical listing source. Both drafts remain unpublished and still require manual comparison with their current listing pages; unknown fields remain unknown. The September 24 Meetup draft is especially time-sensitive because it was imported less than two hours before its reported start.
- Fresh acceptance run `cacff559-4e0d-4396-838d-2da9b139f06c` used an immediately resolved September 24–October 8 window and limit of three. Research returned only the previously known cancelled Meetup, extraction and repair safely produced one canonical rejection with zero scalar mismatches, and the run wrote no draft. Its three requests reported $0.02692323 combined model cost. The run passed the safety/repair boundary but failed the usefulness gate requiring at least one usable draft.
- The discovery-quality correction is implemented offline: the repository reads at most 50 unlinked cancellations attempted in the prior 90 days before any paid request, research receives only their canonical URLs and is told to continue seeking distinct results, and local selection filters exact URLs, tracking/hostname aliases, and matching external IDs even if the model ignores the instruction. Lookup failure stops before research. No existing event or source is modified by the lookup.
- Fresh acceptance run `3c8bd20f-0935-49fb-a8fc-1111cad2c6d6` used an immediately resolved September 25–October 9 window and limit of three. The discovery exclusion found three new Luma/Meetup sources, confirming that the earlier recall failure was fixed. Extraction had exact source coverage and one canonical original. Repair made all three candidates canonical but changed two `source_verification.reason` scalars, so the batch was rejected and the run safely wrote no drafts. The three requests reported $0.03121744 combined model cost; no retry was made.
- An intermediate original-candidate preservation checkpoint proved that a wholly unsafe repair can be discarded while an independently canonical original continues unchanged. Its regression case kept the invented value out of candidates and diagnostics, marked the repair attempted but not applied, wrote the valid original, and left its malformed sibling unlinked. The per-candidate isolation below generalizes that boundary without weakening it.
- Fresh acceptance run `ac1a1fe3-84d5-4e76-b204-67dcd3f87781` used an immediately resolved September 25–October 9 window and limit of three. It refreshed three existing Eventbrite/Luma/Meetup sources, preserved the Eventbrite source's prior event link, and left two sources unlinked. Extraction had exact coverage but zero canonical originals. Repair made all three canonical, then changed one `source_verification.reason`; the batch-wide guard rejected all three and wrote no drafts. The requests reported $0.03272843 combined model cost; no retry was made.
- Per-candidate scalar isolation is implemented offline. Every repaired sibling is checked against only its corresponding original. A changed or malformed sibling reverts to the unchanged original while independently canonical and scalar-preserving siblings continue. Regression coverage starts with zero valid originals, rejects an invented scalar in one repair sibling, retains a safe repaired sibling, writes one draft, leaves one source unlinked, and records `accepted_partial`. A wholly unsafe repair still falls back to any canonical originals or fails closed when none exist.
- Fresh run `edc10f58-32cd-4ab6-9f50-4317358c5139` used a September 26–October 10 window and limit of three. Research returned one previously known Meetup source. Extraction again returned an unfamiliar valid-JSON shape; the generalized repair path isolated the single-source evidence scope, produced one canonical candidate, retained exact source coverage, and reported zero scalar mismatches. The run succeeded with one refreshed source, one draft write, no unlinked sources, and no errors.
- Its three requests reported 17,773 total tokens and $0.02809430 combined model cost, including a $0.00105610 tool-free repair. The search and fetch counters remained missing; bounded citations and exact required-tool/source coverage supplied the existing compatibility evidence.
- A read-only operator preview for the resulting October 9 Startup Grind draft has no workflow blockers. Price, registration availability, categories, and scores remain unknown. The live generalized-repair and useful-draft gates therefore pass, but the current Meetup page still requires manual human verification before any publication decision. Research returned only one result despite a limit of three, so discovery breadth remains an evaluation limitation.

- Review actual request counts, model/tool usage, and cost before expanding the limit.
- Review any real drafts before explicitly authorizing publication to the already-integrated dashboard. Expand to additional providers only after this check passes.
