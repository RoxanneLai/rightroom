import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types.ts";
import type {
  EventDraft,
  IngestionRepository,
  Observation,
  RunSummary,
  ReasoningEffort,
  SaveResult,
  SearchOptions,
} from "./contracts.ts";
import { IngestionError } from "./errors.ts";
import { SqliteIngestionRepository } from "./sqlite-repository.ts";

export function createConfiguredIngestionRepository(
  config:
    | { backend: "sqlite"; path: string }
    | { backend: "supabase"; supabaseUrl: string; serviceRoleKey: string },
  model: string,
  effort: ReasoningEffort,
  repairModel: string,
  repairEffort: ReasoningEffort,
): IngestionRepository {
  if (config.backend === "sqlite")
    return new SqliteIngestionRepository(
      config.path,
      model,
      effort,
      repairModel,
      repairEffort,
    );
  return createIngestionRepository(
    config.supabaseUrl,
    config.serviceRoleKey,
    model,
    effort,
    repairModel,
    repairEffort,
  );
}

export function createIngestionRepository(
  url: string,
  key: string,
  model: string,
  effort: ReasoningEffort,
  repairModel: string,
  repairEffort: ReasoningEffort,
): IngestionRepository {
  const client = createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: "error",
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
            : AbortSignal.timeout(15000),
        }),
    },
  });
  return new SupabaseIngestionRepository(
    client,
    model,
    effort,
    repairModel,
    repairEffort,
  );
}

export class SupabaseIngestionRepository implements IngestionRepository {
  private readonly client: SupabaseClient<Database>;
  private readonly model: string | null;
  private readonly effort: ReasoningEffort | null;
  private readonly repairModel: string | null;
  private readonly repairEffort: ReasoningEffort | null;

  constructor(
    client: SupabaseClient<Database>,
    model: string | null = null,
    effort: ReasoningEffort | null = null,
    repairModel: string | null = null,
    repairEffort: ReasoningEffort | null = null,
  ) {
    this.client = client;
    this.model = model;
    this.effort = effort;
    this.repairModel = repairModel;
    this.repairEffort = repairEffort;
  }

  async start(options: SearchOptions): Promise<string> {
    // Check the migrated schema before allowing the orchestrator to spend on research.
    const { error: schemaError } = await this.client
      .from("event_sources")
      .select("id,last_attempt_at,last_attempt_error")
      .limit(0);
    if (schemaError) throw new IngestionError("ingestion_preflight_failed");
    if (options.profile === "career") {
      const { error: careerError } = await this.client
        .from("events")
        .select("id,career_assessment")
        .limit(0);
      if (careerError) throw new IngestionError("career_migration_required");
    }
    const { data, error } = await this.client
      .from("search_runs")
      .insert({
        agent_name: "founder-radar-discovery",
        agent_version: "0.1.0",
        provider: "openrouter-web-search",
        search_parameters: {
          ...options,
          intent: options.intent ?? "refresh",
          ...(options.profile === "career"
            ? { search_focus: options.search_focus ?? "balanced" }
            : {}),
          model: this.model,
          effort: this.effort,
          repair_model: this.repairModel,
          repair_effort: this.repairEffort,
        },
        status: "running",
      })
      .select("id")
      .single();
    if (error || !data) throw new IngestionError("run_start_failed");
    return data.id;
  }

  async listRecentCancelledSourceUrls(
    since: string,
    limit: number,
  ): Promise<string[]> {
    const { data, error } = await this.client
      .from("event_sources")
      .select("source_url")
      .is("event_id", null)
      .eq("last_attempt_error", "source_page_cancelled")
      .gte("last_attempt_at", since)
      .order("last_attempt_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(limit);
    if (error || data === null)
      throw new IngestionError("source_exclusion_read_failed");
    return data.map((row) => row.source_url);
  }

  async listLinkedSourceUrls(
    from: string,
    to: string,
    limit: number,
  ): Promise<string[]> {
    const { data, error } = await this.client
      .from("event_sources")
      .select("source_url,events!inner(starts_at,is_fixture)")
      .eq("events.is_fixture", false)
      .gte("events.starts_at", new Date(from).toISOString())
      .lt("events.starts_at", new Date(to).toISOString())
      .order("id", { ascending: true })
      .limit(limit);
    if (error || data === null)
      throw new IngestionError("linked_source_exclusion_read_failed");
    return data.map((row) => row.source_url);
  }

  async checkpoint(runId: string, metadata: Json): Promise<void> {
    const { data, error } = await this.client
      .from("search_runs")
      .update({ metadata })
      .eq("id", runId)
      .eq("status", "running")
      .select("id")
      .single();
    if (error || !data) throw new IngestionError("run_checkpoint_failed");
  }

  async save(
    runId: string,
    source: Observation,
    event: EventDraft | null,
    observedAt: string,
  ): Promise<SaveResult> {
    const { data, error } = await this.client
      .rpc("ingest_event_source", {
        p_run_id: runId,
        p_source: { ...source },
        p_event: event ? { ...event } : null,
        p_observed_at: observedAt,
      })
      .single();
    if (error || !data)
      throw new IngestionError(
        error?.code === "PGRST202"
          ? "ingestion_migration_required"
          : "source_save_failed",
      );
    return { ...data, event_id: data.event_id ?? null };
  }

  async finish(summary: RunSummary, metadata: Json): Promise<void> {
    const { data, error } = await this.client
      .from("search_runs")
      .update({
        status: summary.status,
        completed_at: new Date().toISOString(),
        sources_discovered: summary.sources_discovered,
        sources_created: summary.sources_created,
        sources_updated: summary.sources_updated,
        error_message: summary.errors.join(", ") || null,
        metadata,
      })
      .eq("id", summary.run_id)
      .eq("status", "running")
      .select("id")
      .single();
    if (error || !data) throw new IngestionError("run_finish_failed");
  }
}
