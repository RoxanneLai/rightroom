# Hosted pilot readiness

This checkpoint separates locally verified release behavior from the human and hosting decisions still required for a real pilot. It does not claim that RightRoom is deployed, monitored, authenticated, or backed up in production.

## Reproducible release gate

Run the complete credential-free gate from the repository root:

```bash
npm run verify:release
```

The command inventories only tracked and non-ignored source files, rejects credential, database, generated, and traversal paths, and copies the source into an ignored owner-only clean-room directory. It does not copy `.env` files, `OPENROUTER.key`, local SQLite files, `node_modules`, or previous build output. It links the installed dependencies, passes child commands a narrow environment without provider or database credentials, and uses a synthetic SQLite path inside the disposable workspace.

The gate checks whitespace, formatting, generated route types, lint, TypeScript, all offline tests, a production build, compiled-page behavior, and production runtime behavior. Its final Postgres step creates a uniquely named database inside the local Supabase container, applies migrations and seeds, exercises contracts, review, and concurrency, and drops only that disposable database. Logs and a machine-readable report remain under ignored `codex-tmp/release-verification-*`. The runner tries to remove source copies and synthetic storage unless `--keep-workspace` is explicitly requested; if the execution host prevents cleanup, the report sets `workspace_retained` to `true` instead of hiding that limitation.

Use `npm run verify:release -- --skip-database` only for a credential-free application check when the local Supabase container is unavailable. That shorter run is not the complete release gate.

## October 14, 2026 verification

The complete gate passed locally from a credential-free clean-room inventory:

- source whitespace, formatting, route generation, lint, and TypeScript passed;
- all 318 deterministic offline tests passed: 6 unit, 252 ingestion, 43 dashboard, 13 review, and 4 release-isolation tests;
- the clean production build passed, followed by 4 compiled-page checks and 15 production runtime checks;
- all 6 disposable Postgres integration tests passed, including 173 pgTAP assertions plus real review and concurrency paths; and
- synthetic SQLite backup/restore passed integrity, schema-version, foreign-key, permissions, private-evidence, relationship, and snapshot-timing assertions.

The public/private boundary audit found no private evidence field usage in application or component code. Dashboard and production-runtime tests deliberately inject private markers and assert that source content, raw payloads, drafts, privileged keys, and private URL parameters do not reach rendered public output. This remains local evidence, not a penetration test or a hosted access-control review.

## What the gate establishes

- The application can be built from a clean source inventory without local secrets, ignored data, or prior `.next` output.
- Public pages and request-time SQLite behavior pass production-like HTML and runtime checks with synthetic inputs.
- Offline tests cover ingestion, scoring, dashboard boundaries, publication review, recovery, and release isolation.
- SQLite backup uses the database backup API, writes an owner-only copy, verifies integrity and foreign keys, and restores committed private evidence and its relationships without including later mutations.
- Optional Postgres behavior can be checked without resetting or altering the normal local development database.

## What remains before a hosted pilot

| Decision or control              | Why it remains open                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting topology                 | Choose a Node/Docker host, reverse proxy, persistent storage, and whether the application will remain a single instance.                                                                      |
| Persistent backend               | SQLite requires one persistent writable volume and a single coordinated application instance; managed Supabase is the alternative for multiple hosts and stronger operational tooling.        |
| Authentication and access        | The repository has a private operator review boundary, not a hosted login or authorization product. Decide who can view the pilot and who can review or publish.                              |
| Production backup policy         | Choose the backup destination, encryption, retention, recovery-point objective, recovery-time objective, and a recurring restore drill. The synthetic rehearsal is not a backup of real data. |
| Monitoring and incident response | Choose uptime/error monitoring, alert recipients, log retention, and an operator response process.                                                                                            |
| Cost and paid discovery          | Keep paid ingestion disabled until a separately approved provider tariff and attempt ceiling are enforceable.                                                                                 |
| Product evidence                 | Complete the seven-event PM cohort review and make event-by-event publication decisions; local technical readiness does not establish ranking usefulness or user value.                       |

## Suggested sequence

1. Run and review the complete local gate, including the disposable Postgres step.
2. Complete the PM research cohort decisions and keep publication separate from scoring calibration.
3. Choose the pilot host, persistent backend, access model, and spending policy.
4. Document production backup and monitoring ownership, then perform a real restore drill in a non-production environment.
5. Deploy a private pilot, run a production smoke test, and record evidence without claiming outcomes the pilot has not measured.
