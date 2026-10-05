# Offline acceptance pack

Run the deterministic discovery-to-publication integration checks without Docker, database credentials, an OpenRouter key, or paid calls:

```sh
npm run test:acceptance:offline
```

The same eight checks are included in normal `npm test`. They use a fixed September 2026 clock/window, synthetic listing HTML and provider responses, and newly initialized SQLite files under ignored `codex-tmp/offline-acceptance-*/`. Each scratch directory is owner-only. Existing databases and saved live responses are never opened. The synthetic credential is passed directly to the provider constructor; no credential loader or key file is used.

## What the pack exercises

These are integration tests, not mocked repository tests. They use the real OpenRouter request/response adapter, discovery selection, native page-capture validation and text extraction, normalization, transactional SQLite repository, run inspector, review/publication implementation, and public dashboard reader. Only external model, DNS, and page transports are replaced. Additional guards block real fetch, HTTPS-request, and DNS-lookup transports and assert that none were attempted.

- Founder and career discovery: an explicit manifest overrides misleading legacy prose; rejected/background and uncited listings cannot reach capture. A `needs_verification` lead can obtain supporting facts from its own independently captured page, but still must pass ordinary eligibility validation.
- Evidence preservation: one narrowly allowed extra JSON escape layer in the attendance-mode quote produces a private normalization note and operator warning. Original model facts/quotes remain unchanged; private captured text and hashes are retained. Unknown model fields remain unknown rather than acquiring defaults.
- Refresh safety: repeated ingestion reuses source/event IDs. A failed capture skips extraction/repair and preserves the prior successful evidence, event, and linkage while recording the failed attempt. Publication is blocked until that failure is resolved.
- Review/public boundary: drafts are absent from the public feed. Missing approval and stale review tokens are rejected. Explicit approval of a synthetic temporary event records private publication history; the feed contains approved public fields, not source text, normalization notes, or review tokens. Later ingestion cannot overwrite the published event or its approval history.
- Expansion: a known tracking/hostname alias is locally excluded before capture while a new verification lead is ingested. Both drafts stay private.
- Empty and invalid selections: empty/rejected-only manifests finish without capture/extraction/repair; malformed or unstructured selections fail closed rather than promoting narrative citations. The terminal run status is persisted in SQLite.
- Candidate isolation: an ungrounded double-escaped quote and an already-started candidate remain source-only while a valid sibling becomes a private draft.
- Bounded repair: unfamiliar but source-complete extraction JSON can be repaired once. Fact-preserving output reaches SQLite; an invented title is rejected without a retry or publication. Model-request counts and tool-free strict extraction/repair bodies are checked.

All publication operations in this pack concern synthetic events in isolated test databases, never real events. Inspection and dashboard results are checked for private-data leakage. The ordinary offline suite separately covers plan-only CLI behavior, configuration precedence, detailed repair edge cases, and mocked Supabase compatibility.

## Limits

Passing proves the local adapters and safety boundaries work together for these synthetic cases. It does not prove that a live model follows the manifest/schema, that search finds a useful breadth of events, that a website is reachable/rendered correctly, or that quoted claims are semantically true. The pack does not run a real Supabase/Postgres server or simulate simultaneous CLI/dashboard processes. Those have separate verification paths. A fresh, explicitly authorized live acceptance run and human listing review remain necessary before claiming live discovery quality.

Scratch databases are retained under `codex-tmp/` for troubleshooting and are not committed. There is no need to repeatedly run this pack overnight: it completes quickly and is intended to catch regressions after relevant changes.

## Verification checkpoint — October 3, 2026

The eight acceptance checks and all 225 normal offline tests pass (6 unit, 189 ingestion, 17 dashboard, 13 review). Formatting, lint, TypeScript with incremental output disabled, and `git diff --check` pass. This change adds tests, their focused runner, and documentation only; application code, dependencies, migrations, and provider configuration are unchanged. No production build or real Supabase integration was rerun for this test-only change.
