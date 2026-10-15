import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { loadDashboard } from "../../lib/dashboard/repository.ts";
import { executeSqliteInspection } from "../../lib/ingestion/inspection.ts";
import { SqliteIngestionRepository } from "../../lib/ingestion/sqlite-repository.ts";
import { executeSqliteReview } from "../../lib/review/repository.ts";
import { runReviewCli } from "../../lib/review/cli.ts";
import { readDatabaseSelection } from "../../lib/storage/config.ts";
import {
  backupSqliteDatabase,
  verifySqliteBackup,
} from "../../lib/storage/sqlite-backup.ts";
import { openSqliteDatabase } from "../../lib/storage/sqlite.ts";
import { importSupabaseSnapshot } from "../../lib/storage/supabase-import.ts";

const from = "2026-09-24T12:00:00.000Z";
const startsAt = "2026-10-01T22:00:00.000Z";
const now = new Date("2026-09-24T12:00:00.000Z");

async function temporaryDatabase() {
  await mkdir("codex-tmp", { recursive: true });
  const directory = await mkdtemp("codex-tmp/sqlite-test-");
  return { directory, path: join(directory, "founder-radar.sqlite") };
}

function source(overrides = {}) {
  return {
    source_name: "luma.com",
    source_url: "https://luma.com/sqlite-test",
    external_id: "sqlite-test",
    content_text: "Verified synthetic listing evidence",
    content_hash: "synthetic-hash",
    raw_payload: { synthetic: true },
    ...overrides,
  };
}

function draft(overrides = {}) {
  return {
    title: "Synthetic SQLite event",
    organizer_name: null,
    starts_at: startsAt,
    ends_at: null,
    time_zone: "America/New_York",
    venue_name: "Synthetic venue",
    address_line: null,
    city: "New York",
    region: "NY",
    country_code: "US",
    event_format: "in-person",
    price_amount_cents: null,
    currency_code: null,
    registration_status: "open",
    ...overrides,
  };
}

test("SQLite is the strict default and Supabase remains an explicit backend", () => {
  const selection = readDatabaseSelection({}, "/synthetic/project");
  assert.deepEqual(selection, {
    backend: "sqlite",
    path: "/synthetic/project/data/founder-radar.sqlite",
  });
  assert.deepEqual(readDatabaseSelection({ DATABASE_BACKEND: "supabase" }), {
    backend: "supabase",
  });
  assert.throws(() => readDatabaseSelection({ DATABASE_BACKEND: "unknown" }));
  assert.throws(() => readDatabaseSelection({ SQLITE_DATABASE_PATH: "   " }));
});

test("SQLite review lists upcoming and expired drafts separately", async () => {
  const temporary = await temporaryDatabase();
  const repository = new SqliteIngestionRepository(
    temporary.path,
    "openai/gpt-5.6-luna",
    "medium",
    "openai/gpt-5.6-luna",
    "medium",
  );
  const runId = await repository.start({
    from,
    to: "2026-10-08T12:00:00.000Z",
    limit: 3,
  });
  await repository.save(
    runId,
    source(),
    draft({ title: "Upcoming draft" }),
    from,
  );
  await repository.save(
    runId,
    source({
      source_url: "https://luma.com/expired-sqlite-test",
      external_id: "expired-sqlite-test",
    }),
    draft({
      title: "Expired draft",
      starts_at: "2026-09-23T22:00:00.000Z",
    }),
    from,
  );
  const execute = async (options) =>
    executeSqliteReview(options, temporary.path, now);
  const upcoming = await runReviewCli(["list"], execute, now);
  const expired = await runReviewCli(
    ["list", "--scope", "expired"],
    execute,
    now,
  );
  assert.deepEqual(
    upcoming.drafts.map((event) => event.title),
    ["Upcoming draft"],
  );
  assert.deepEqual(
    expired.drafts.map((event) => event.title),
    ["Expired draft"],
  );
  assert.equal(upcoming.scope, "upcoming");
  assert.equal(expired.scope, "expired");
});

test("SQLite preserves deduplication, evidence, reviews, publication safety, and private boundaries", async () => {
  const temporary = await temporaryDatabase();
  const repository = new SqliteIngestionRepository(
    temporary.path,
    "openai/gpt-5.6-luna",
    "medium",
    "openai/gpt-5.6-luna",
    "medium",
  );
  const runId = await repository.start({
    from,
    to: "2026-10-08T12:00:00.000Z",
    limit: 3,
  });
  const saved = await repository.save(runId, source(), draft(), from);
  assert.equal(saved.source_created, true);
  assert.equal(saved.event_written, true);
  const repeated = await repository.save(
    runId,
    source({ content_text: "Updated successful evidence" }),
    draft(),
    "2026-09-24T12:01:00.000Z",
  );
  assert.equal(repeated.source_id, saved.source_id);
  assert.equal(repeated.event_id, saved.event_id);
  assert.equal(repeated.source_created, false);
  await repository.save(
    runId,
    source({
      content_text: undefined,
      content_hash: undefined,
      raw_payload: undefined,
      error_code: "source_fetch_failed",
    }),
    null,
    "2026-09-24T12:02:00.000Z",
  );
  let database = openSqliteDatabase(temporary.path);
  let storedSource = database
    .prepare(
      "select content_text, event_id, last_attempt_error from event_sources where id = ?",
    )
    .get(saved.source_id);
  assert.equal(storedSource.content_text, "Updated successful evidence");
  assert.equal(storedSource.event_id, saved.event_id);
  assert.equal(storedSource.last_attempt_error, "source_fetch_failed");
  database.close();
  await repository.save(
    runId,
    source({ content_text: "Final successful evidence" }),
    draft(),
    "2026-09-24T12:03:00.000Z",
  );
  await repository.finish(
    {
      run_id: runId,
      status: "succeeded",
      sources_discovered: 1,
      sources_created: 1,
      sources_updated: 0,
      events_written: 1,
      sources_unlinked: 0,
      errors: [],
    },
    {
      consulted_urls: [source().source_url],
      summary: { provider_diagnostics: [] },
    },
  );
  const inspection = executeSqliteInspection(runId, temporary.path);
  assert.equal(inspection.run.id, runId);
  assert.equal(inspection.sources.length, 1);
  assert.doesNotMatch(
    JSON.stringify(inspection),
    /Final successful evidence|raw_payload|synthetic-hash/,
  );
  const preview = executeSqliteReview(
    {
      command: "preview",
      eventId: saved.event_id,
      sourceId: saved.source_id,
      approved: false,
      database: "postgres",
    },
    temporary.path,
    now,
  );
  database = openSqliteDatabase(temporary.path);
  database
    .prepare("update events set title = ? where id = ?")
    .run("Changed after preview", saved.event_id);
  database.close();
  assert.throws(() =>
    executeSqliteReview(
      {
        command: "publish",
        eventId: saved.event_id,
        sourceId: saved.source_id,
        token: preview.review_token,
        approved: true,
        database: "postgres",
      },
      temporary.path,
      now,
    ),
  );
  const fresh = executeSqliteReview(
    {
      command: "preview",
      eventId: saved.event_id,
      sourceId: saved.source_id,
      approved: false,
      database: "postgres",
    },
    temporary.path,
    now,
  );
  const published = executeSqliteReview(
    {
      command: "publish",
      eventId: saved.event_id,
      sourceId: saved.source_id,
      token: fresh.review_token,
      approved: true,
      database: "postgres",
    },
    temporary.path,
    now,
  );
  assert.equal(published.publication_status, "published");
  const dashboard = await loadDashboard({
    env: { DATABASE_BACKEND: "sqlite", SQLITE_DATABASE_PATH: temporary.path },
    now,
    fetch: async () => assert.fail("SQLite dashboard must not use network"),
  });
  assert.equal(dashboard.status, "ready");
  assert.equal(dashboard.events.length, 1);
  assert.equal(dashboard.events[0].title, "Changed after preview");
  assert.doesNotMatch(
    JSON.stringify(dashboard),
    /Final successful evidence|raw_payload|synthetic-hash/,
  );
  const protectedWrite = await repository.save(
    await repository.start({
      from,
      to: "2026-10-08T12:00:00.000Z",
      limit: 1,
    }),
    source({ content_text: "New evidence after publication" }),
    draft({ title: "Must not overwrite reviewed event" }),
    "2026-09-24T12:04:00.000Z",
  );
  assert.equal(protectedWrite.event_written, false);
  database = openSqliteDatabase(temporary.path);
  assert.equal(
    database
      .prepare("select title from events where id = ?")
      .get(saved.event_id).title,
    "Changed after preview",
  );
  assert.equal(
    database
      .prepare("select count(*) as count from event_publication_reviews")
      .get().count,
    1,
  );
  database.close();
});

test("SQLite backup and restore preserves committed private data and relationships", async () => {
  const temporary = await temporaryDatabase();
  const repository = new SqliteIngestionRepository(
    temporary.path,
    "openai/gpt-5.6-luna",
    "medium",
    "openai/gpt-5.6-luna",
    "medium",
  );
  const runId = await repository.start({
    from,
    to: "2026-10-08T12:00:00.000Z",
    limit: 1,
  });
  const saved = await repository.save(
    runId,
    source({ content_text: "Private committed backup evidence" }),
    draft({ title: "Backup snapshot title" }),
    from,
  );
  const backupPath = join(temporary.directory, "restored.sqlite");
  await backupSqliteDatabase(temporary.path, backupPath);
  const sourceDatabase = openSqliteDatabase(temporary.path);
  sourceDatabase
    .prepare("update events set title = ? where id = ?")
    .run("Mutation after backup", saved.event_id);
  sourceDatabase.close();
  assert.deepEqual(verifySqliteBackup(backupPath), {
    integrity: "ok",
    schemaVersion: 2,
    foreignKeyViolations: 0,
  });
  assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
  const restored = new DatabaseSync(backupPath, { readOnly: true });
  try {
    assert.deepEqual(
      {
        ...restored
          .prepare(
            `select e.title, s.event_id, s.discovered_by_run_id, s.content_text
             from events e join event_sources s on s.event_id = e.id
             where e.id = ?`,
          )
          .get(saved.event_id),
      },
      {
        title: "Backup snapshot title",
        event_id: saved.event_id,
        discovered_by_run_id: runId,
        content_text: "Private committed backup evidence",
      },
    );
  } finally {
    restored.close();
  }
});

test("explicit Supabase import preserves IDs, relationships, evidence, runs, and review history", async () => {
  const temporary = await temporaryDatabase();
  const runId = "10000000-0000-4000-8000-000000000001";
  const eventId = "40000000-0000-4000-8000-000000000001";
  const sourceId = "60000000-0000-4000-8000-000000000001";
  const reviewId = "70000000-0000-4000-8000-000000000001";
  const timestamp = "2026-09-24T12:00:00.000Z";
  const snapshot = {
    search_runs: [
      {
        id: runId,
        agent_name: "founder-radar-discovery",
        agent_version: "0.1.0",
        provider: "openrouter-web-search",
        search_parameters: { limit: 1 },
        status: "succeeded",
        started_at: timestamp,
        completed_at: timestamp,
        sources_discovered: 1,
        sources_created: 1,
        sources_updated: 0,
        error_message: null,
        metadata: { summary: {} },
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    events: [
      {
        id: eventId,
        title: "Imported synthetic event",
        organizer_name: null,
        starts_at: startsAt,
        ends_at: null,
        time_zone: "America/New_York",
        venue_name: null,
        address_line: null,
        neighborhood: null,
        borough: null,
        city: "New York",
        region: "NY",
        country_code: "US",
        event_format: "in-person",
        categories: ["Founder"],
        price_amount_cents: null,
        currency_code: null,
        registration_status: "open",
        publication_status: "published",
        is_fixture: false,
        founder_score: null,
        investor_score: null,
        networking_score: 80,
        recommendation: null,
        potential_downside: null,
        scoring_version: null,
        first_seen_at: timestamp,
        last_seen_at: timestamp,
        published_at: timestamp,
        public_registration_url: "https://luma.com/imported-event",
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    event_sources: [
      {
        id: sourceId,
        event_id: eventId,
        discovered_by_run_id: runId,
        source_name: "luma.com",
        source_kind: "listing",
        external_id: "imported-event",
        source_url: "https://luma.com/imported-event",
        registration_url: null,
        fetched_at: timestamp,
        first_seen_at: timestamp,
        last_seen_at: timestamp,
        last_attempt_at: timestamp,
        last_attempt_error: null,
        http_status: null,
        content_hash: "imported-hash",
        content_text: "Imported private evidence",
        raw_payload: { imported: true },
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    event_publication_reviews: [
      {
        id: reviewId,
        event_id: eventId,
        source_id: sourceId,
        review_token: "a".repeat(64),
        review_snapshot: { imported: true },
        approved_at: timestamp,
        approved_by_role: "postgres",
      },
    ],
  };
  assert.deepEqual(importSupabaseSnapshot(snapshot, temporary.path), {
    search_runs: 1,
    events: 1,
    event_sources: 1,
    event_publication_reviews: 1,
  });
  const database = openSqliteDatabase(temporary.path);
  assert.deepEqual(
    {
      ...database
        .prepare(
          "select event_id, discovered_by_run_id, content_text from event_sources",
        )
        .get(),
    },
    {
      event_id: eventId,
      discovered_by_run_id: runId,
      content_text: "Imported private evidence",
    },
  );
  assert.equal(
    database.prepare("select id from event_publication_reviews").get().id,
    reviewId,
  );
  database.close();
  assert.throws(() => importSupabaseSnapshot(snapshot, temporary.path));
});
