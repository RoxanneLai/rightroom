# Offline ingestion-quality evaluation

## Purpose

The evaluation command measures where the local ingestion pipeline is losing useful results before more prompting, parser, or model work is authorized. It combines the selected SQLite database's allowlisted run summaries with matching ignored `codex-tmp/ingestion-<run-id>.json` checkpoints. It never loads research reports, source text, raw payloads, prompts, credentials, or reasoning traces.

It is descriptive, not a live model benchmark. Historical runs span different prompts, schemas, compatibility code, and model settings. The report therefore includes both the complete history and a clearly labeled latest-five-terminal-run cohort. It does not claim that old and new runs are directly comparable.

## Run it

Use the SQLite database whose history you want to inspect:

```bash
DATABASE_BACKEND=sqlite \
SQLITE_DATABASE_PATH=data/imported-founder-radar.sqlite \
npm run ingest:evaluate -- run
```

Optional local paths must remain under ignored `codex-tmp/`:

```bash
DATABASE_BACKEND=sqlite \
SQLITE_DATABASE_PATH=data/imported-founder-radar.sqlite \
npm run ingest:evaluate -- run \
  --checkpoints codex-tmp \
  --output codex-tmp/ingestion-quality-report.json
```

No arguments prints help before database or checkpoint access. The evaluator rejects Supabase rather than silently switching backends. It opens SQLite read-only and writes only the requested owner-readable report file. It makes no network or paid requests, retries, database writes, or publication changes.

## Metric definitions

| Metric                      | Meaning                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| Candidate-slot fill rate    | Discovered sources, capped at each run's requested limit, divided by requested candidate slots            |
| Usable draft writes         | Inserted or refreshed draft writes reported by terminal runs; not necessarily unique newly created events |
| Draft-write rate            | Usable draft writes divided by discovered source observations                                             |
| Loss categories             | Safe errors grouped into discovery, provider, verification, response-shape, eligibility, or validation    |
| Repair-run rate             | Runs containing an observed repair request divided by runs with request diagnostics                       |
| Cost per usable draft write | Provider-reported cost from cost-complete runs divided by their usable draft writes                       |
| Source error counts         | Each source row's latest attempt result, not an append-only history                                       |
| Retained link without write | A discovered source remained linked to an existing event without a draft write during that run            |
| Expected rejection          | A per-source diagnostic for an explicitly stale, cancelled, virtual, irrelevant or out-of-scope listing   |
| Source-capture failure      | A per-source diagnostic from direct capture or historical hosted-fetch verification                       |
| Extraction/validation loss  | A per-source diagnostic for response compatibility, missing facts, grounding, time or schema validation   |
| Marketplace share           | Meetup, Luma and Eventbrite consultations divided by all recorded listing consultations                   |
| Source-family link rate     | Current non-synthetic source rows linked to events divided by stored rows for a fixed safe source family  |

The source-outcome funnel reconciles discovered observations into draft writes, observations left unlinked after the run, and retained existing links without a write. Retained links are not lost sources: they can represent a protected published event, an unchanged existing event or a failed refresh whose earlier good link was preserved. Per-source failure observations are reported separately and can overlap retained links. Provider failures that discover no sources remain run-level failures rather than being divided into the source funnel.

Per-source failure counts come only from fixed error codes in candidate-failure and source-capture diagnostics. The evaluator groups them as expected rejection, source capture, extraction or validation, provider or transport, discovery execution, operator cancellation, or another fixed safe category. It does not read or emit the accompanying source IDs, URLs, candidate values, quotes or private failure snapshots. Source portfolio output uses only the fixed labels `meetup`, `luma`, `eventbrite`, and `first_party_or_other`. It excludes synthetic `.example.invalid` URLs and never emits a stored hostname or listing URL. Costs and token totals are unverified provider diagnostics. Missing values remain missing instead of being inferred as zero. Aggregate output includes no run IDs, source URLs, event facts, or private text.

## October 13, 2026 cleanup and source portfolio follow-up

All 11 records still marked `running` were individually previewed at their unchanged revisions after confirming that no process held the SQLite file. A consistent backup was written under ignored `codex-tmp/` first. The recovery command then closed the records as `cancelled`, preserving every run, source, event and audit field without retries or deletion. The follow-up list returned zero running records.

After cleanup, all 54 discovery runs are terminal and summarized. The historical candidate-slot fill rate is 51.23%; the decrease from the pre-cleanup 64.34% reflects the 11 confirmed interrupted attempts now correctly included as zero-result terminal runs. The latest five terminal runs remain the more relevant operational cohort: they filled 8 of 15 requested slots and produced 2 usable draft writes from 8 source observations.

The new safe source-portfolio metrics show 91 recorded consultations after normalizing `www` variants: 46 Meetup, 23 Luma, 14 Eventbrite, 7 first-party FINOS listings and 1 first-party Datadog listing. Marketplace platforms therefore account for 91.2% of consultations. Current non-synthetic rows link 9 of 12 Meetup sources, 1 of 9 Luma sources, 3 of 4 Eventbrite sources, 1 of 1 FINOS source and 0 of 1 Datadog source to events. These are diagnostic historical rates across changing implementations, not controlled platform comparisons. The Luma result supports a focused evidence review before more Luma search volume; the portfolio concentration supports one bounded first-party organizer comparison before another broad source adapter.

The saved-evidence review did not reproduce a current Luma-specific defect. The nine historical Luma rows span three invalid repair outputs, two fetch failures, two past-page rejections, one incomplete event and one extraction-shape error across September 3 through October 3. The preserved three-case replay contains Meetup and Eventbrite evidence rather than a Luma response, and all three cases pass the current adapter. The existing history therefore cannot distinguish a remaining Luma incompatibility from legacy response-shape behavior, inaccessible pages, or correct stale-event rejection. No Luma code was changed without a reproducible failure. The next bounded Luma failure should be captured and replayed offline before an adapter change is considered.

The refined recent funnel no longer treats the 25% draft-write rate as a 75% current conversion failure. Across the latest five terminal runs, eight source observations produced two draft writes, two retained links without a write and four observations left unlinked after their runs. Per-source diagnostics record two correct past-page rejections, one capture failure and two extraction-or-validation failures; a separate provider failure discovered no sources. These runs span compatibility changes, and retained links include protected existing records. The evaluator therefore recommends checking whether capture or validation failures predate current code and replaying preserved evidence before changing prompts, models or adapters.

## September 27, 2026 checkpoint

The first report evaluated 40 OpenRouter discovery runs in the imported SQLite history. All 33 terminal runs had a safe summary; 28 also matched ignored checkpoint files. Seven records remained marked `running` and require individual confirmation through `ingest:recover` before any cancellation.

Across the full history, runs filled 67 of 99 requested candidate slots (67.7%) and reported 11 usable draft writes from 67 discovered-source observations (16.4%). Twenty-six runs had complete provider-reported cost fields; their reported total was $0.52772985, or $0.04797544 per usable draft write. These are historical development costs, not a forecast of the current pipeline.

The latest five terminal runs are more relevant to the current implementation: four were partial and one succeeded; they discovered 9 of 15 requested candidates (60.0%), produced one usable draft write (11.1% of discovered-source observations), and used repair in three of five diagnostic-covered runs. Their error summaries contained two `invalid_repair_output` and two `invalid_extraction_shape` results, so all four recent recorded losses fall into the `response_shape` category. The newest successful run demonstrates that generalized repair now handles one of those unfamiliar shapes; a captured-response replay is needed before assuming that every historical response-shape failure still applies.

The report's evidence-based order is:

1. Preview the seven `running` records and close only those confirmed interrupted.
2. Replay preserved recent response-shape failures through the current offline parser and repair boundary.
3. Compare bounded discovery-query strategies on one fixed window because recent runs filled only 60% of requested slots.
4. Continue tracking structured-output compatibility because 60% of the recent cohort used repair.

Manual comparison of accepted drafts with their canonical listing pages remains outside this automated report and is still required before publication.

## Replay preserved responses offline

Use the capture replayer to test private, previously saved provider responses against the current extraction, compatibility, repair, and deterministic validation code. The manifest and captures stay under ignored `codex-tmp/`; the generated report is owner-readable and contains no run IDs, URLs, event facts, research text, or response text.

```bash
DATABASE_BACKEND=sqlite \
SQLITE_DATABASE_PATH=data/imported-founder-radar.sqlite \
npm run ingest:replay -- run \
  --manifest codex-tmp/capture-replay-manifest.json
```

The strict manifest format is:

```json
{
  "version": 1,
  "cases": [
    {
      "label": "recent-shape-failure",
      "run_id": "00000000-0000-4000-8000-000000000000",
      "capture_context": "original_failure",
      "captures": ["codex-tmp/private-response.json"]
    }
  ]
}
```

`capture_context` must be `original_failure`, `follow_up_failure`, `follow_up_success`, or `unknown`. This distinction is essential: a later diagnostic response can show that the current adapter handles that later response, but it cannot prove that an unpreserved original failure is fixed. Supply a second capture only when it is the repair response paired with the first extraction response.

No arguments prints help before database or capture access. The command rejects Supabase, paths outside `codex-tmp/`, malformed manifests, oversized captures, and incomplete capture sequences. It opens SQLite read-only, uses a local response substitute rather than `fetch`, reads no credentials, and makes no network requests, paid calls, database writes, publication changes, or retries.

The September 29 replay contained three preserved cases. All three were accepted by the current adapter, producing four candidates that also passed current deterministic event validation. The one exact original-failure capture now yields two usable candidates and one explicit `source_fetch_failed` rejection from its three source verdicts, without invoking repair. A later three-source diagnostic also yields two usable candidates and one explicit cancellation rejection without repair. The final one-source diagnostic is structurally accepted but remains intentionally unusable because it reports insufficient source evidence. Only the first case is an exact original-failure capture; the other two are follow-up diagnostics, and original responses for the other recent failures were not retained.
