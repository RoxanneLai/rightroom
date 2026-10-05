import "server-only";
import { DatabaseSync } from "node:sqlite";
import type { Json } from "../database.types.ts";
import {
  jsonText,
  newId,
  openSqliteDatabase,
  withImmediateTransaction,
} from "../storage/sqlite.ts";
import type {
  EventDraft,
  IngestionRepository,
  Observation,
  ReasoningEffort,
  RunSummary,
  SaveResult,
  SearchOptions,
} from "./contracts.ts";
import { IngestionError } from "./errors.ts";

type SourceRow = {
  id: string;
  event_id: string | null;
  external_id: string | null;
  first_seen_at: string;
  last_attempt_at: string | null;
};

type EventRow = {
  id: string;
  first_seen_at: string;
  last_seen_at: string;
  publication_status: string;
  is_fixture: number;
};

function nullable(
  value: string | number | null | undefined,
): string | number | null {
  return value ?? null;
}

function required(value: string | undefined): string {
  if (!value) throw new IngestionError("source_save_failed");
  return value;
}

function timestamp(value: string | undefined): string {
  const milliseconds = Date.parse(required(value));
  if (!Number.isFinite(milliseconds))
    throw new IngestionError("source_save_failed");
  return new Date(milliseconds).toISOString();
}

function optionalTimestamp(value: string | null | undefined): string | null {
  return value ? timestamp(value) : null;
}

function validateObservation(
  source: Observation,
  event: EventDraft | null,
): void {
  if (
    !source.source_name.trim() ||
    !source.source_url.startsWith("https://") ||
    (source.external_id !== null && !source.external_id.trim()) ||
    (source.error_code !== undefined &&
      !/^[a-z_]{1,80}$/.test(source.error_code)) ||
    (source.error_code !== undefined && event !== null)
  )
    throw new IngestionError("source_save_failed");
  if (
    event !== null &&
    (!source.content_text?.trim() ||
      !event.title?.trim() ||
      !event.starts_at ||
      !event.time_zone ||
      !event.city ||
      !event.region ||
      !event.country_code ||
      !event.event_format)
  )
    throw new IngestionError("source_save_failed");
}

function sourceByIdentity(
  database: DatabaseSync,
  source: Observation,
): SourceRow | undefined {
  const byUrl = database
    .prepare(
      `select id, event_id, external_id, first_seen_at, last_attempt_at
       from event_sources where source_name = ? and source_url = ?`,
    )
    .get(source.source_name, source.source_url) as SourceRow | undefined;
  const byExternal = source.external_id
    ? (database
        .prepare(
          `select id, event_id, external_id, first_seen_at, last_attempt_at
           from event_sources where source_name = ? and external_id = ?`,
        )
        .get(source.source_name, source.external_id) as SourceRow | undefined)
    : undefined;
  if (byUrl && byExternal && byUrl.id !== byExternal.id)
    throw new IngestionError("source_save_failed");
  const existing = byUrl ?? byExternal;
  if (
    existing?.external_id &&
    source.external_id &&
    existing.external_id !== source.external_id
  )
    throw new IngestionError("source_save_failed");
  return existing;
}

function createSource(
  database: DatabaseSync,
  runId: string,
  source: Observation,
  observedAt: string,
): SourceRow {
  const id = newId();
  database
    .prepare(
      `insert into event_sources (
        id, event_id, discovered_by_run_id, source_name, external_id, source_url,
        first_seen_at, last_seen_at, raw_payload, created_at, updated_at
      ) values (?, null, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    )
    .run(
      id,
      runId,
      source.source_name,
      source.external_id,
      source.source_url,
      observedAt,
      observedAt,
      observedAt,
      observedAt,
    );
  return {
    id,
    event_id: null,
    external_id: source.external_id,
    first_seen_at: observedAt,
    last_attempt_at: null,
  };
}

function updateSource(
  database: DatabaseSync,
  row: SourceRow,
  source: Observation,
  observedAt: string,
): void {
  database
    .prepare(
      `update event_sources set
        source_url = ?, external_id = coalesce(?, external_id),
        last_seen_at = max(last_seen_at, ?), last_attempt_at = ?,
        last_attempt_error = ?, updated_at = ? where id = ?`,
    )
    .run(
      source.source_url,
      source.external_id,
      observedAt,
      observedAt,
      source.error_code ?? null,
      observedAt,
      row.id,
    );
  if (!source.error_code && source.content_text?.trim())
    database
      .prepare(
        `update event_sources set content_text = ?, content_hash = ?, raw_payload = ?,
         fetched_at = ?, updated_at = ? where id = ?`,
      )
      .run(
        source.content_text,
        source.content_hash ?? null,
        jsonText(source.raw_payload ?? {}),
        observedAt,
        observedAt,
        row.id,
      );
}

function writeDraft(
  database: DatabaseSync,
  source: SourceRow,
  draft: EventDraft,
  observedAt: string,
): string | null {
  const existing = source.event_id
    ? (database
        .prepare(
          `select id, first_seen_at, last_seen_at, publication_status, is_fixture
           from events where id = ?`,
        )
        .get(source.event_id) as EventRow | undefined)
    : undefined;
  if (
    existing &&
    (existing.publication_status !== "draft" ||
      existing.is_fixture === 1 ||
      existing.last_seen_at > observedAt)
  )
    return null;
  const id = existing?.id ?? newId();
  const firstSeenAt = existing?.first_seen_at ?? source.first_seen_at;
  if (existing) {
    database
      .prepare(
        `update events set title = ?, organizer_name = ?, starts_at = ?, ends_at = ?,
         time_zone = ?, venue_name = ?, address_line = ?, city = ?, region = ?,
         country_code = ?, event_format = ?, price_amount_cents = ?, currency_code = ?,
         registration_status = ?, last_seen_at = max(last_seen_at, ?), updated_at = ?
         where id = ?`,
      )
      .run(
        required(draft.title),
        nullable(draft.organizer_name),
        timestamp(draft.starts_at),
        optionalTimestamp(draft.ends_at),
        required(draft.time_zone),
        nullable(draft.venue_name),
        nullable(draft.address_line),
        required(draft.city),
        required(draft.region),
        required(draft.country_code),
        required(draft.event_format),
        nullable(draft.price_amount_cents),
        nullable(draft.currency_code),
        draft.registration_status ?? "unknown",
        observedAt,
        observedAt,
        id,
      );
  } else {
    database
      .prepare(
        `insert into events (
          id, title, organizer_name, starts_at, ends_at, time_zone, venue_name,
          address_line, city, region, country_code, event_format, price_amount_cents,
          currency_code, registration_status, publication_status, is_fixture,
          first_seen_at, last_seen_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, ?, ?)`,
      )
      .run(
        id,
        required(draft.title),
        nullable(draft.organizer_name),
        timestamp(draft.starts_at),
        optionalTimestamp(draft.ends_at),
        required(draft.time_zone),
        nullable(draft.venue_name),
        nullable(draft.address_line),
        required(draft.city),
        required(draft.region),
        required(draft.country_code),
        required(draft.event_format),
        nullable(draft.price_amount_cents),
        nullable(draft.currency_code),
        draft.registration_status ?? "unknown",
        firstSeenAt,
        observedAt,
        observedAt,
        observedAt,
      );
  }
  database
    .prepare("update event_sources set event_id = ? where id = ?")
    .run(id, source.id);
  database
    .prepare("update events set career_assessment = ? where id = ?")
    .run(
      draft.career_assessment ? jsonText(draft.career_assessment) : null,
      id,
    );
  return id;
}

/** Recovery reuses the normal source/draft write inside its caller's transaction. */
export function saveRecoveredDraft(
  database: DatabaseSync,
  sourceId: string,
  draft: EventDraft,
  source: Observation,
  observedAt: string,
): string {
  const row = database
    .prepare(
      "select id, event_id, external_id, first_seen_at, last_attempt_at from event_sources where id = ?",
    )
    .get(sourceId) as SourceRow | undefined;
  if (!row || row.event_id !== null)
    throw new IngestionError("recovery_source_linked");
  validateObservation(source, draft);
  updateSource(database, row, source, observedAt);
  const eventId = writeDraft(database, row, draft, observedAt);
  if (!eventId) throw new IngestionError("recovery_write_failed");
  return eventId;
}

export class SqliteIngestionRepository implements IngestionRepository {
  private readonly path: string;
  private readonly model: string;
  private readonly effort: ReasoningEffort;
  private readonly repairModel: string;
  private readonly repairEffort: ReasoningEffort;

  constructor(
    path: string,
    model: string,
    effort: ReasoningEffort,
    repairModel: string,
    repairEffort: ReasoningEffort,
  ) {
    this.path = path;
    this.model = model;
    this.effort = effort;
    this.repairModel = repairModel;
    this.repairEffort = repairEffort;
  }

  private use<T>(operation: (database: DatabaseSync) => T): T {
    const database = openSqliteDatabase(this.path);
    try {
      return operation(database);
    } finally {
      database.close();
    }
  }

  async start(options: SearchOptions): Promise<string> {
    return this.use((database) => {
      const id = newId();
      const now = new Date().toISOString();
      database
        .prepare(
          `insert into search_runs (
            id, agent_name, agent_version, provider, search_parameters, status,
            started_at, metadata, created_at, updated_at
          ) values (?, 'founder-radar-discovery', '0.1.0', 'openrouter-web-search',
            ?, 'running', ?, '{}', ?, ?)`,
        )
        .run(
          id,
          jsonText({
            ...options,
            intent: options.intent ?? "refresh",
            ...(options.profile === "career"
              ? { search_focus: options.search_focus ?? "balanced" }
              : {}),
            model: this.model,
            effort: this.effort,
            repair_model: this.repairModel,
            repair_effort: this.repairEffort,
          }),
          now,
          now,
          now,
        );
      return id;
    });
  }

  async listRecentCancelledSourceUrls(
    since: string,
    limit: number,
  ): Promise<string[]> {
    return this.use((database) =>
      (
        database
          .prepare(
            `select source_url from event_sources where event_id is null
             and last_attempt_error = 'source_page_cancelled' and last_attempt_at >= ?
             order by last_attempt_at desc, id asc limit ?`,
          )
          .all(since, limit) as Array<{ source_url: string }>
      ).map((row) => row.source_url),
    );
  }

  async listLinkedSourceUrls(
    from: string,
    to: string,
    limit: number,
  ): Promise<string[]> {
    try {
      const database = new DatabaseSync(this.path, { readOnly: true });
      try {
        database.exec("pragma busy_timeout = 5000");
        return (
          database
            .prepare(
              `select s.source_url from event_sources s join events e on s.event_id = e.id
           where e.is_fixture = 0 and julianday(e.starts_at) >= julianday(?)
           and julianday(e.starts_at) < julianday(?) order by s.id asc limit ?`,
            )
            .all(
              new Date(from).toISOString(),
              new Date(to).toISOString(),
              limit,
            ) as Array<{ source_url: string }>
        ).map((row) => row.source_url);
      } finally {
        database.close();
      }
    } catch {
      throw new IngestionError("linked_source_exclusion_read_failed");
    }
  }

  async checkpoint(runId: string, metadata: Json): Promise<void> {
    this.use((database) => {
      const result = database
        .prepare(
          "update search_runs set metadata = ?, updated_at = ? where id = ? and status = 'running'",
        )
        .run(jsonText(metadata), new Date().toISOString(), runId);
      if (result.changes !== 1)
        throw new IngestionError("run_checkpoint_failed");
    });
  }

  async save(
    runId: string,
    source: Observation,
    event: EventDraft | null,
    observedAt: string,
  ): Promise<SaveResult> {
    validateObservation(source, event);
    const observationTime = timestamp(observedAt);
    return this.use((database) =>
      withImmediateTransaction(database, () => {
        const active = database
          .prepare(
            "select id from search_runs where id = ? and status = 'running'",
          )
          .get(runId);
        if (!active) throw new IngestionError("source_save_failed");
        let row = sourceByIdentity(database, source);
        const created = !row;
        row ??= createSource(database, runId, source, observationTime);
        if (row.last_attempt_at && row.last_attempt_at > observationTime)
          return {
            source_id: row.id,
            event_id: row.event_id,
            source_created: false,
            event_written: false,
          };
        updateSource(database, row, source, observationTime);
        const eventId = event
          ? writeDraft(database, row, event, observationTime)
          : null;
        return {
          source_id: row.id,
          event_id: eventId ?? row.event_id,
          source_created: created,
          event_written: eventId !== null,
        };
      }),
    );
  }

  async finish(summary: RunSummary, metadata: Json): Promise<void> {
    this.use((database) => {
      const now = new Date().toISOString();
      const result = database
        .prepare(
          `update search_runs set status = ?, completed_at = ?, sources_discovered = ?,
           sources_created = ?, sources_updated = ?, error_message = ?, metadata = ?,
           updated_at = ? where id = ? and status = 'running'`,
        )
        .run(
          summary.status,
          now,
          summary.sources_discovered,
          summary.sources_created,
          summary.sources_updated,
          summary.errors.join(", ") || null,
          jsonText(metadata),
          now,
          summary.run_id,
        );
      if (result.changes !== 1) throw new IngestionError("run_finish_failed");
    });
  }
}
