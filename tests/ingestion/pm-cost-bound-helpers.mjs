import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readCareerTarget } from "../../lib/career/profile.ts";
import {
  API_LIMITS,
  OpenRouterSearchProvider,
} from "../../lib/ingestion/openrouter-provider.ts";
import { PM_MODEL } from "../../lib/ingestion/acceptance-budget.ts";
import {
  SOURCE_CAPTURE_LIMITS,
  extractSourceText,
} from "../../lib/ingestion/source-page.ts";
import { sourceIdentity } from "../../lib/ingestion/sources.ts";
import {
  fixture,
  listing,
  manifest,
  clock,
} from "./offline-acceptance-helpers.mjs";

/** Fill an exact UTF-16 limit, including supplementary-plane test characters. */
function fill(pattern, length) {
  return (
    pattern.repeat(Math.floor(length / pattern.length)) +
    "a".repeat(length % pattern.length)
  );
}

/** Only aggregate byte measurements leave this helper; synthetic content stays private. */
function measure(body, phase) {
  const schema = body.response_format?.json_schema.schema;
  return {
    phase,
    body_bytes: Buffer.byteLength(JSON.stringify(body)),
    message_bytes: body.messages.reduce(
      (sum, message) => sum + Buffer.byteLength(message.content),
      0,
    ),
    schema_bytes: schema ? Buffer.byteLength(JSON.stringify(schema)) : 0,
    schema_in_system_message: schema
      ? body.messages[0].content.includes(JSON.stringify(schema))
      : false,
    output_token_limit: body.max_tokens,
    server_tool_count: body.tools?.length ?? 0,
    max_tool_calls: body.max_tool_calls ?? 0,
  };
}

/** Bound the synthetic report and malformed response at the existing limits. */
function syntheticReplies(fixtures, pattern) {
  const block = manifest(fixtures.map(({ sourceUrl }) => listing(sourceUrl)));
  const report =
    fill(pattern, API_LIMITS.reportCharacters - block.length - 1) +
    "\n" +
    block;
  const malformed = {
    candidates: fixtures.map(({ event }) => ({
      ...event,
      title: "synthetic-malformed-fact",
    })),
    padding: "",
  };
  const initial = JSON.stringify(malformed).length;
  malformed.padding = "a".repeat(API_LIMITS.repairInputCharacters - initial);
  const extraction = JSON.stringify(malformed);
  assert.equal(extraction.length, API_LIMITS.repairInputCharacters);
  return [report, extraction, "not JSON"];
}

/** Capture aggregate request sizes using injected replies, never a network client. */
function measuredProvider(fixtures, replies, bodies, measurements) {
  const phases = ["research", "extraction", "repair"];
  return new OpenRouterSearchProvider(
    "synthetic-not-a-credential",
    PM_MODEL,
    "medium",
    async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      measurements.push(measure(body, phases[bodies.length - 1]));
      return Response.json({
        id: "gen-synthetic-pm-size",
        model: PM_MODEL,
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: replies.shift(),
              annotations:
                bodies.length === 1
                  ? fixtures.map(({ sourceUrl }) => ({
                      type: "url_citation",
                      url_citation: { url: sourceUrl },
                    }))
                  : [],
            },
          },
        ],
        usage: {
          cost: 0,
          server_tool_use: { web_search_requests: bodies.length === 1 ? 3 : 0 },
        },
      });
    },
  );
}

/** Construct private synthetic text snapshots without visiting original listings. */
function syntheticPages(fixtures, pattern) {
  return fixtures.map(({ sourceUrl, html }) => {
    const seed = extractSourceText(html, "text/html");
    const text =
      seed + fill(pattern, SOURCE_CAPTURE_LIMITS.textCharacters - seed.length);
    const hash = createHash("sha256").update(text).digest("hex");
    return {
      evidence_kind: "source_page_text_v1",
      source_url: sourceUrl,
      retrieval_url: sourceUrl,
      final_url: sourceUrl,
      fetched_at: clock.toISOString(),
      http_status: 200,
      content_type: "text/plain",
      response_bytes: Buffer.byteLength(text),
      redirects: 0,
      body_hash: hash,
      text_hash: hash,
      text,
    };
  });
}

/** Assert that only the existing three bounded, correctly configured calls ran. */
function assertMeasuredRequests(bodies, replies) {
  assert.equal(bodies.length, 3);
  assert.equal(replies.length, 0);
  assert.equal(
    JSON.parse(bodies[0].messages[1].content).excluded_source_urls.length,
    50,
  );
  for (const body of bodies) {
    assert.equal(body.model, PM_MODEL);
    assert.deepEqual(body.reasoning, { effort: "medium", exclude: true });
  }
  assert.equal(bodies[1].tools, undefined);
  assert.equal(bodies[2].tools, undefined);
}

/** Exercise the real provider with three maximum-sized synthetic captured pages.
 * All HTTP replies are injected. No key loader, database, DNS or website is used.
 */
export async function measurePmRequests(pattern = "a") {
  const fixtures = [1, 2, 3].map((number) =>
    fixture(`https://luma.com/synthetic-pm-${number}`),
  );
  const sources = fixtures.map(({ sourceUrl }) => sourceIdentity(sourceUrl));
  const bodies = [];
  const measurements = [];
  const replies = syntheticReplies(fixtures, pattern);
  const provider = measuredProvider(fixtures, replies, bodies, measurements);
  const options = {
    from: clock.toISOString(),
    to: new Date(clock.getTime() + 14 * 86400000).toISOString(),
    profile: "career",
    search_focus: "product",
    intent: "expand",
    searches: 3,
    limit: 3,
    career_target: await readCareerTarget(),
  };
  const excluded = Array.from({ length: 50 }, (_, index) => {
    const prefix = `https://luma.com/excluded-${index}-`;
    return prefix + "a".repeat(2000 - prefix.length);
  });
  const signal = new AbortController().signal;
  const research = await provider.research(options, signal, excluded);
  await assert.rejects(
    provider.extract(
      { ...research, source_pages: syntheticPages(fixtures, pattern) },
      sources,
      options,
      signal,
    ),
    /invalid_repair_json/,
  );
  assertMeasuredRequests(bodies, replies);
  return measurements;
}
