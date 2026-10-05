import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readCareerTarget } from "../../lib/career/profile.ts";
import { OpenRouterSearchProvider } from "../../lib/ingestion/openrouter-provider.ts";
import { captureSourcePage } from "../../lib/ingestion/source-capture.ts";
import { SqliteIngestionRepository } from "../../lib/ingestion/sqlite-repository.ts";
import { runIngestion } from "../../lib/ingestion/run.ts";
import { candidate, fact, options, report, url } from "./helpers.mjs";

export const clock = new Date("2026-09-01T12:00:00Z");
export const privateMarker = "PRIVATE_ACCEPTANCE_EVIDENCE";
export const attendanceQuote =
  'eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode';
const model = "vendor/offline-acceptance";
const target = await readCareerTarget();

/** Synthetic HTML and source-specific facts; no saved live listing content. */
export function fixture(sourceUrl = url, profile = "career", revision = "") {
  const title = "Founder Test" + revision;
  const text = report
    .replaceAll(url, sourceUrl)
    .replaceAll("Founder Test", title);
  const event = candidate(sourceUrl);
  for (const field of Object.values(event)) {
    if (field?.quote) field.quote = text;
  }
  event.title.value = title;
  event.event_format = fact(
    "in-person",
    JSON.stringify(attendanceQuote).slice(1, -1),
  );
  event.price_amount_cents = fact(null);
  event.currency_code = fact(null);
  event.registration_status = fact(null);
  if (profile === "career") {
    event.relevant_to_founders = fact(null);
    event.career = {
      kind: fact("product", "Product discovery discussion."),
      product_relevance: fact("direct", "Product discovery discussion."),
      delivery_relevance: fact(null),
      domain: fact(null),
      eligibility: fact(null),
      restrictions: [],
      prerequisites: [],
      people: [],
      interaction: fact(null),
      hiring: fact(null),
      startup_context: fact(null),
      founders: [],
    };
  }
  const structured = {
    "@type": "Event",
    name: title,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
  };
  return {
    sourceUrl,
    event,
    html: `<html><body><p>${text}</p><p>Product discovery discussion. ${privateMarker}</p><script type="application/ld+json">${JSON.stringify(structured)}</script></body></html>`,
  };
}

export function manifest(listings, prose = "Synthetic discovery report") {
  return `${prose}\n\n\`\`\`rightroom-discovery-v1\n${JSON.stringify({ version: "rightroom-discovery-v1", listings })}\n\`\`\``;
}

export function listing(sourceUrl, disposition = "selected") {
  return { source_url: sourceUrl, disposition };
}

/** Every database is newly created beneath the ignored project scratch directory. */
export async function databasePath() {
  await mkdir("codex-tmp", { recursive: true });
  const directory = await mkdtemp(resolve("codex-tmp/offline-acceptance-"));
  await chmod(directory, 0o700);
  return resolve(directory, "synthetic.sqlite");
}

/** Read-only snapshots make unintended inspection/publication writes observable. */
export function rows(path, table) {
  assert.ok(
    [
      "events",
      "event_sources",
      "search_runs",
      "event_publication_reviews",
    ].includes(table),
  );
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return database.prepare(`select * from ${table} order by id`).all();
  } finally {
    database.close();
  }
}

function routerResponse(content, urls, phase) {
  return new Response(
    JSON.stringify({
      id: `gen-offline-acceptance-${phase}`,
      model,
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content,
            annotations: urls.map((url) => ({
              type: "url_citation",
              url_citation: { url },
            })),
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        completion_tokens_details: { reasoning_tokens: 2 },
        total_tokens: 30,
        ...(phase === "research"
          ? { server_tool_use: { web_search_requests: 1 } }
          : {}),
      },
    }),
  );
}

/** Mock only the gateway transport, retaining the real provider adapter. */
function offlineProvider(content, citations, extraction, repair) {
  const requests = [];
  const provider = new OpenRouterSearchProvider(
    "synthetic-not-a-credential",
    model,
    "medium",
    async (endpoint, init) => {
      assert.equal(endpoint, "https://openrouter.ai/api/v1/chat/completions");
      const request = JSON.parse(init.body);
      requests.push(request);
      assert.ok(requests.length <= (repair === undefined ? 2 : 3));
      assert.deepEqual(request.reasoning, { effort: "medium", exclude: true });
      assert.equal(request.provider.require_parameters, true);
      if (requests.length === 1) {
        assert.equal(request.tool_choice, "required");
        return routerResponse(content, citations, "research");
      }
      assert.equal(request.tools, undefined);
      assert.equal(request.response_format.type, "json_schema");
      assert.equal(request.response_format.json_schema.strict, true);
      return routerResponse(
        requests.length === 3 ? repair : extraction,
        [],
        requests.length === 3 ? "repair" : "extraction",
      );
    },
    model,
    "medium",
  );
  return { provider, requests };
}

/** Keep DNS validation, capture bounds, extraction and hashing real. */
function offlineCapture(fixtures, captureStatus) {
  const captures = [];
  const resolutions = [];
  const captureSource = (source, retrievalUrl, signal) =>
    captureSourcePage(source, retrievalUrl, signal, {
      now: () => new Date(clock),
      resolve: async (hostname) => {
        resolutions.push(hostname);
        assert.equal(hostname, "luma.com");
        return [{ address: "93.184.216.34", family: 4 }];
      },
      request: async (requestedUrl) => {
        captures.push(requestedUrl.href);
        const item = fixtures.find(
          (item) => item.sourceUrl === requestedUrl.href,
        );
        assert.ok(
          item,
          "only an explicitly supplied synthetic page may be captured",
        );
        return {
          status: captureStatus,
          headers: { "content-type": "text/html" },
          body: Buffer.from(item.html),
        };
      },
    });
  return { captureSource, captures, resolutions };
}

/** Orchestrate the real ingestion flow using an explicit temporary database. */
export async function ingest({
  path,
  profile = "career",
  fixtures = [fixture(url, profile)],
  listings = fixtures.map((item) => listing(item.sourceUrl)),
  content = manifest(listings),
  citations = listings.map((item) => item.source_url),
  candidates = fixtures.map((item) => item.event),
  extraction = JSON.stringify({ candidates }),
  repair,
  captureStatus = 200,
  intent = "refresh",
}) {
  const { provider, requests } = offlineProvider(
    content,
    citations,
    extraction,
    repair,
  );
  const { captureSource, captures, resolutions } = offlineCapture(
    fixtures,
    captureStatus,
  );
  const summary = await runIngestion(
    {
      ...options,
      profile,
      intent,
      ...(profile === "career" ? { searches: 3, career_target: target } : {}),
    },
    {
      provider,
      repository: new SqliteIngestionRepository(
        path,
        model,
        "medium",
        model,
        "medium",
      ),
      signal: new AbortController().signal,
      now: () => new Date(clock),
      captureSource,
    },
  );
  assert.equal(resolutions.length, captures.length);
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(privateMarker));
  return { summary, requests, captures };
}
