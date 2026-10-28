import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenRouterSearchProvider,
  API_LIMITS,
} from "../../lib/ingestion/openrouter-provider.ts";
import { runIngestion } from "../../lib/ingestion/run.ts";
import { selectSources } from "../../lib/ingestion/sources.ts";
import { IngestionError } from "../../lib/ingestion/errors.ts";
import {
  candidate,
  memoryRepository,
  report,
  rejectedCandidate,
  options,
  url,
} from "./helpers.mjs";

const signal = new AbortController().signal;
const key = "offline-test-not-a-key";
const testNow = () => new Date("2026-09-01T12:00:00Z");

function response(text, searches = 0, fetches = null) {
  return {
    id: "gen-offline-test",
    model: "openai/gpt-4.1",
    choices: [
      {
        finish_reason: "stop",
        message: {
          role: "assistant",
          content:
            searches && text.startsWith(report)
              ? `### 1. Founder Test\n${text}`
              : text,
          annotations: searches
            ? [
                {
                  type: "url_citation",
                  url_citation: {
                    url,
                    title: "Founder Test",
                    content: "untrusted snippet",
                  },
                },
              ]
            : [],
        },
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      cost: 0.001,
      server_tool_use: {
        web_search_requests: searches,
        ...(fetches === null ? {} : { web_fetch_requests: fetches }),
      },
    },
  };
}

function extractionResponse(text, fetches = 1) {
  return response(text, 0, fetches);
}

function providerWithResponses(
  responses,
  model = "openai/gpt-4.1",
  effort = "low",
  repairModel = "openai/gpt-5.6-luna",
  repairEffort = "medium",
) {
  const requests = [];
  const provider = new OpenRouterSearchProvider(
    key,
    model,
    effort,
    async (input, init) => {
      requests.push({
        input: String(input),
        init,
        body: init.body ? JSON.parse(init.body) : null,
      });
      const next = responses.shift();
      assert.ok(next, "unexpected extra API call");
      return new Response(JSON.stringify(next.body ?? next), {
        status: next.httpStatus ?? 200,
        headers: { "content-type": "application/json" },
      });
    },
    repairModel,
    repairEffort,
  );
  return { requests, provider };
}

function legacyFlatCandidate(sourceUrl = url) {
  const value = candidate(sourceUrl);
  return {
    source_url: value.source_url,
    source_verification: value.source_verification,
    title: value.title.value,
    title_quote: value.title.quote,
    starts_at: value.starts_at.value,
    starts_at_quote: value.starts_at.quote,
    ends_at: value.ends_at.value,
    ends_at_quote: value.ends_at.quote,
    time_zone: value.time_zone.value,
    time_zone_quote: value.time_zone.quote,
    venue_name: value.venue_name.value,
    venue_name_quote: value.venue_name.quote,
    city: value.city.value,
    city_quote: value.city.quote,
    region: value.region.value,
    region_quote: value.region.quote,
    country_code: value.country_code.value,
    country_code_quote: value.country_code.quote,
    event_format: value.event_format.value,
    event_format_quote: value.event_format.quote,
    founder_investor_relevance: value.relevant_to_founders.value,
    founder_investor_relevance_quote: value.relevant_to_founders.quote,
    organizer: value.organizer_name.value,
    organizer_quote: value.organizer_name.quote,
    price_amount_cents: value.price_amount_cents.value,
    price_amount_cents_quote: value.price_amount_cents.quote,
    currency_code: value.currency_code.value,
    currency_code_quote: value.currency_code.quote,
    registration_status: value.registration_status.value,
    registration_status_quote: value.registration_status.quote,
  };
}

function legacyFlatRejection(sourceUrl = url) {
  const value = legacyFlatCandidate(sourceUrl);
  value.source_verification = { status: "rejected", reason: "failed_fetch" };
  for (const key of Object.keys(value)) {
    if (key !== "source_url" && key !== "source_verification")
      value[key] = null;
  }
  return value;
}

function alternateFlatCandidate(sourceUrl = url) {
  const value = legacyFlatCandidate(sourceUrl);
  return {
    source_url: value.source_url,
    source_verification: value.source_verification,
    title: value.title,
    title_quote: value.title_quote,
    starts_at: value.starts_at,
    starts_at_quote: value.starts_at_quote,
    ends_at: value.ends_at,
    ends_at_quote: value.ends_at_quote,
    time_zone: value.time_zone,
    time_zone_quote: value.time_zone_quote,
    venue: value.venue_name,
    venue_quote: value.venue_name_quote,
    city: value.city,
    city_quote: value.city_quote,
    region: value.region,
    region_quote: value.region_quote,
    country_code: value.country_code,
    country_code_quote: value.country_code_quote,
    event_format: value.event_format,
    event_format_quote: value.event_format_quote,
    relevant_to_founders: value.founder_investor_relevance,
    relevance_quote: value.founder_investor_relevance_quote,
    organizer: value.organizer,
    organizer_quote: value.organizer_quote,
    price_amount_cents: value.price_amount_cents,
    price_amount_cents_quote: value.price_amount_cents_quote,
    currency_code: value.currency_code,
    currency_code_quote: value.currency_code_quote,
    registration_status: value.registration_status,
    registration_status_quote: value.registration_status_quote,
  };
}

function alternateFlatRejection(sourceUrl = url) {
  const value = alternateFlatCandidate(sourceUrl);
  value.source_verification = { status: "rejected", reason: "cancelled" };
  for (const key of Object.keys(value)) {
    if (key !== "source_url" && key !== "source_verification")
      value[key] = null;
  }
  return value;
}

function legacyNestedCandidate(sourceUrl = url) {
  const value = candidate(sourceUrl);
  return {
    source_url: value.source_url,
    source_verification: value.source_verification,
    title: value.title,
    starts_at: value.starts_at,
    ends_at: value.ends_at,
    time_zone: value.time_zone,
    venue: value.venue_name,
    city: value.city,
    region: value.region,
    country_code: value.country_code,
    event_format: value.event_format,
    founder_investor_relevance: {
      value: "Useful to founders and investors",
      quote: value.relevant_to_founders.quote,
    },
    organizer: value.organizer_name,
    price_amount_cents: value.price_amount_cents,
    currency_code: value.currency_code,
    registration_status: value.registration_status,
  };
}

function legacyNestedRejection(sourceUrl = url) {
  const value = legacyNestedCandidate(sourceUrl);
  value.source_verification = { status: "rejected", reason: "failed_fetch" };
  for (const key of Object.keys(value)) {
    if (key !== "source_url" && key !== "source_verification")
      value[key] = { value: null, quote: null };
  }
  return value;
}

test("OpenRouter sends bounded search and source-fetched structured extraction offline", async () => {
  const { provider, requests } = providerWithResponses(
    [
      response(report, 2),
      extractionResponse(JSON.stringify({ candidates: [candidate()] })),
    ],
    "google/test-model",
  );
  const excluded = "https://luma.com/cancelled-event";
  const research = await provider.research(
    { ...options, intent: "expand" },
    signal,
    [
      excluded,
      excluded + "?utm_source=duplicate",
      "https://example.com/not-allowed",
    ],
  );
  assert.deepEqual(research.urls, [url]);
  assert.equal(research.metadata.usage.total_tokens, 30);
  assert.equal(research.metadata.usage.cost, 0.001);
  assert.equal(research.metadata.search_tool_calls, 2);
  assert.equal(research.metadata.requested_model, "google/test-model");
  assert.equal(research.metadata.requested_effort, "low");
  assert.equal(research.metadata.model, "openai/gpt-4.1");
  assert.equal(research.metadata.intent, "expand");
  assert.equal(research.metadata.usage.reasoning_tokens, null);
  const extracted = await provider.extract(
    research,
    selectSources(research.urls, 3),
    options,
    signal,
  );
  assert.equal(extracted.candidates.length, 1);
  assert.equal(extracted.metadata.requested_effort, "low");
  assert.equal(extracted.metadata.fetch_verification, "usage_counter");
  for (const request of requests) {
    assert.equal(
      request.input,
      "https://openrouter.ai/api/v1/chat/completions",
    );
    assert.equal(request.init.redirect, "error");
    assert.equal(request.init.headers.Authorization, "Bearer " + key);
    assert.equal(request.init.headers["X-OpenRouter-Metadata"], "enabled");
    assert.equal(request.body.model, "google/test-model");
    assert.deepEqual(request.body.reasoning, {
      effort: "low",
      exclude: true,
    });
    assert.deepEqual(request.body.provider, {
      require_parameters: true,
      allow_fallbacks: false,
    });
    assert.equal(request.body.stream, false);
    assert.ok(!JSON.stringify(request.body).includes(key));
  }
  const search = requests[0].body;
  assert.equal(search.max_tool_calls, API_LIMITS.searchToolCalls);
  assert.equal(search.tools[0].type, "openrouter:web_search");
  assert.equal(search.tools[0].parameters.engine, "exa");
  assert.equal(search.tools[0].parameters.max_uses, 3);
  assert.equal(search.tools[0].parameters.max_total_results, 15);
  assert.equal(search.tools[0].parameters.max_characters, 2000);
  assert.ok(search.tools[0].parameters.allowed_domains.includes("luma.com"));
  assert.ok(
    search.tools[0].parameters.allowed_domains.includes("productcircle.co"),
  );
  assert.equal(search.tool_choice, "required");
  assert.equal(search.max_tokens, API_LIMITS.researchOutputTokens);
  const researchPayload = JSON.parse(search.messages[1].content);
  assert.equal(researchPayload.discovery_intent, "expand");
  assert.deepEqual(researchPayload.excluded_source_urls, [excluded]);
  assert.equal(researchPayload.max_candidates, options.limit);
  assert.match(search.messages[0].content, /do not stop after the first/i);
  assert.match(search.messages[0].content, /excluded_source_urls/);
  const extraction = requests[1].body;
  assert.equal(extraction.response_format.type, "json_schema");
  assert.equal(extraction.response_format.json_schema.strict, true);
  assert.equal(
    extraction.response_format.json_schema.schema.additionalProperties,
    false,
  );
  assert.equal(
    extraction.response_format.json_schema.schema.properties.candidates
      .minItems,
    1,
  );
  assert.equal(
    extraction.response_format.json_schema.schema.properties.candidates
      .maxItems,
    1,
  );
  const relevanceValueSchema =
    extraction.response_format.json_schema.schema.properties.candidates.items
      .properties.relevant_to_founders.properties.value;
  assert.ok(JSON.stringify(relevanceValueSchema).includes("true"));
  assert.ok(!JSON.stringify(relevanceValueSchema).includes("false"));
  assert.equal(extraction.tools[0].type, "openrouter:web_fetch");
  assert.equal(extraction.tools[0].parameters.engine, "openrouter");
  assert.equal(extraction.tools[0].parameters.max_uses, 1);
  assert.equal(
    extraction.tools[0].parameters.max_content_tokens,
    API_LIMITS.fetchContentTokens,
  );
  assert.deepEqual(
    extraction.tools[0].parameters.allowed_domains,
    search.tools[0].parameters.allowed_domains,
  );
  assert.equal(
    provider.getDiagnostics()[1].fetch_verification,
    "usage_counter",
  );
  assert.equal(provider.getDiagnostics()[1].extraction_candidate_count, 1);
  assert.equal(
    provider.getDiagnostics()[1].extraction_candidate_format,
    "canonical",
  );
  assert.equal(provider.getDiagnostics()[1].repair_validation, null);
  assert.equal(provider.getDiagnostics()[1].repair_scalar_mismatch_count, null);
  assert.equal(provider.getDiagnostics()[1].repair_scalar_mismatch_paths, null);
  assert.equal(provider.getDiagnostics()[1].extraction_schema_valid_count, 1);
  assert.equal(provider.getDiagnostics()[1].extraction_source_match_count, 1);
  assert.equal(
    provider.getDiagnostics()[1].extraction_duplicate_source_count,
    0,
  );
  assert.equal(
    provider.getDiagnostics()[1].extraction_untrusted_source_count,
    0,
  );
  assert.equal(provider.getDiagnostics()[1].requested_effort, "low");
  assert.equal(
    provider.getDiagnostics()[1].extraction_shape,
    "candidates_object",
  );
  assert.equal(extraction.tool_choice, "required");
  assert.equal(extraction.max_tool_calls, 1);
  assert.equal(extraction.max_tokens, API_LIMITS.extractionOutputTokens);
  const extractionPayload = JSON.parse(extraction.messages[1].content);
  assert.deepEqual(extractionPayload.source_urls, [url]);
  assert.equal(extractionPayload.accepted_starts_at_gte, options.from);
  assert.equal(extractionPayload.accepted_starts_at_lt, options.to);
  assert.ok(!JSON.stringify(research.metadata).includes("untrusted snippet"));
  await assert.rejects(provider.research(options, signal), /api_call_limit/);
  assert.equal(requests.length, 2);
  assert.equal(provider.getDiagnostics().length, 2);
  assert.deepEqual(
    provider.getDiagnostics().map((item) => item.phase),
    ["research", "extraction"],
  );
  assert.ok(
    provider.getDiagnostics().every((item) => item.requested_effort === "low"),
  );
  assert.equal(provider.getDiagnostics()[0].extraction_shape, null);
  const copy = provider.getDiagnostics();
  copy[0].usage.cost = 9000;
  assert.equal(provider.getDiagnostics()[0].usage.cost, 0.001);
});

test("credit, rate, authentication and provider errors stop without retries or raw error leaks", async () => {
  for (const [status, code] of [
    [402, "provider_quota_or_rate_limit"],
    [429, "provider_quota_or_rate_limit"],
    [401, "provider_authentication_failed"],
    [403, "provider_access_denied"],
    [503, "provider_request_failed"],
  ]) {
    for (const httpStatus of [status, 200]) {
      const { provider, requests } = providerWithResponses([
        { httpStatus, body: { error: { code: status, message: key } } },
      ]);
      await assert.rejects(provider.research(options, signal), (error) => {
        assert.equal(error.code, code);
        assert.ok(!error.message.includes(key));
        return true;
      });
      assert.equal(requests.length, 1);
    }
  }
  const denial = providerWithResponses([
    {
      httpStatus: 403,
      body: {
        error: {
          code: 403,
          message: "No endpoints satisfy the data policy " + key,
        },
        openrouter_metadata: {
          attempt: 0,
          endpoints: {
            total: 2,
            available: [{ selected: false }, { selected: false }],
          },
          pipeline: [],
        },
      },
    },
  ]).provider;
  await assert.rejects(denial.research(options, signal), (error) => {
    assert.equal(error.code, "provider_access_denied");
    return true;
  });
  const [denialDiagnostic] = denial.getDiagnostics();
  assert.equal(denialDiagnostic.access_denial, "data_policy");
  assert.equal(denialDiagnostic.router_attempt, 0);
  assert.equal(denialDiagnostic.router_endpoint_total, 2);
  assert.equal(denialDiagnostic.router_endpoint_available_count, 2);
  assert.equal(denialDiagnostic.router_endpoint_selected_count, 0);
  assert.equal(denialDiagnostic.router_guardrail_stage_count, 0);
  assert.ok(!JSON.stringify(denialDiagnostic).includes(key));
  const guardrail = providerWithResponses([
    {
      httpStatus: 403,
      body: {
        error: { code: 403, message: key },
        openrouter_metadata: {
          attempt: 0,
          pipeline: [{ type: "guardrail", private_details: key }],
        },
      },
    },
  ]).provider;
  await assert.rejects(guardrail.research(options, signal), {
    message: "provider_access_denied",
  });
  const [guardrailDiagnostic] = guardrail.getDiagnostics();
  assert.equal(guardrailDiagnostic.access_denial, "guardrail");
  assert.equal(guardrailDiagnostic.router_guardrail_stage_count, 1);
  assert.ok(!JSON.stringify(guardrailDiagnostic).includes(key));
});

test("incomplete, refused, malformed, missing-search and over-budget responses fail closed", async () => {
  const incomplete = response("partial", 1);
  incomplete.choices[0].finish_reason = "length";
  const refused = response("", 1);
  refused.choices[0].message.refusal = "refused";
  const missingUsage = response(report, 1);
  delete missingUsage.usage;
  missingUsage.choices[0].message.annotations = [];
  const tools = response(report, 1);
  tools.choices[0].message.tool_calls = [{ id: "unexecuted" }];
  for (const [value, expected] of [
    [incomplete, /provider_incomplete/],
    [refused, /provider_refused/],
    [response(report), /search_not_performed/],
    [missingUsage, /search_usage_missing/],
    [response(report, 4), /search_tool_limit_exceeded/],
    [tools, /provider_incomplete/],
    [{ choices: [] }, /invalid_provider_response/],
  ]) {
    await assert.rejects(
      providerWithResponses([value]).provider.research(options, signal),
      expected,
    );
  }
});

test("oversized bodies/reports, invalid JSON, extra candidates and extraction searches are rejected", async () => {
  await assert.rejects(
    providerWithResponses([
      response("x".repeat(API_LIMITS.reportCharacters + 1), 1),
    ]).provider.research(options, signal),
    /invalid_research_report/,
  );
  await assert.rejects(
    providerWithResponses([
      response("x".repeat(API_LIMITS.responseBytes + 1), 1),
    ]).provider.research(options, signal),
    /provider_response_too_large/,
  );
  for (const [text, expected] of [
    ["not json", /invalid_extraction_json/],
    ['{"candidates":{}}', /invalid_extraction_shape/],
    [
      JSON.stringify({ candidates: Array(2).fill(candidate()) }),
      /invalid_extraction_shape/,
    ],
  ]) {
    await assert.rejects(
      providerWithResponses([extractionResponse(text)]).provider.extract(
        { report, urls: [url], metadata: {} },
        selectSources([url], 3),
        options,
        signal,
      ),
      expected,
    );
  }
  await assert.rejects(
    providerWithResponses([
      response(JSON.stringify({ candidates: [candidate()] }), 1, 1),
    ]).provider.extract(
      { report, urls: [url], metadata: {} },
      selectSources([url], 3),
      options,
      signal,
    ),
    /unexpected_extraction_search/,
  );
});

test("invalid extraction shape records only a bounded candidate count", async () => {
  const body = JSON.stringify({
    candidates: [
      candidate(),
      { ...candidate(), title: { value: "Other", quote: "Other" } },
    ],
  });
  const { provider } = providerWithResponses([extractionResponse(body)]);
  await assert.rejects(
    provider.extract(
      { report, urls: [url], metadata: {} },
      selectSources([url], 3),
      options,
      signal,
    ),
    /invalid_extraction_shape/,
  );
  const diagnostic = provider.getDiagnostics()[0];
  assert.equal(diagnostic.extraction_shape, "candidates_object");
  assert.equal(diagnostic.extraction_candidate_count, 2);
  assert.equal(diagnostic.extraction_schema_valid_count, 2);
  assert.equal(diagnostic.extraction_source_match_count, 1);
  assert.equal(diagnostic.extraction_duplicate_source_count, 1);
  assert.equal(diagnostic.extraction_untrusted_source_count, 0);
  assert.ok(!JSON.stringify(diagnostic).includes("Other"));
  assert.ok(!JSON.stringify(diagnostic).includes(url));
});

test("local adapters accept narrow candidate-envelope aliases without repair", async () => {
  for (const [body, shape] of [
    [JSON.stringify([candidate()]), "candidate_array"],
    [
      JSON.stringify({ event_candidates: [candidate()] }),
      "schema_named_object",
    ],
    [
      JSON.stringify(JSON.stringify({ candidates: [candidate()] })),
      "encoded_candidate_envelope",
    ],
  ]) {
    const value = extractionResponse(body);
    delete value.usage.server_tool_use.web_fetch_requests;
    const { provider } = providerWithResponses([value]);
    const extracted = await provider.extract(
      { report, urls: [url], metadata: {} },
      selectSources([url], 3),
      options,
      signal,
    );
    assert.equal(extracted.candidates.length, 1);
    assert.equal(
      extracted.metadata.fetch_verification,
      "required_tool_and_source_coverage",
    );
    assert.equal(provider.getDiagnostics()[0].extraction_shape, shape);
    assert.equal(provider.getDiagnostics()[0].extraction_candidate_count, 1);
  }
});

test("one bounded repair canonicalizes unfamiliar source-scoped JSON wrappers", async () => {
  for (const body of [
    JSON.stringify({ events: [candidate()] }),
    JSON.stringify({ candidates: [candidate()], extra: true }),
  ]) {
    const value = extractionResponse(body);
    delete value.usage.server_tool_use.web_fetch_requests;
    const { provider, requests } = providerWithResponses([
      value,
      response(JSON.stringify({ candidates: [candidate()] }), 0),
    ]);
    const extracted = await provider.extract(
      { report, urls: [url], metadata: {} },
      selectSources([url], 3),
      options,
      signal,
    );
    assert.deepEqual(extracted.candidates, [candidate()]);
    assert.equal(extracted.metadata.repair_attempted, true);
    assert.equal(extracted.metadata.repair_applied, true);
    assert.equal(requests.length, 2);
    assert.equal(provider.getDiagnostics()[0].extraction_shape, "invalid");
    assert.equal(provider.getDiagnostics()[0].extraction_candidate_count, null);
    assert.equal(
      provider.getDiagnostics()[0].extraction_candidate_format,
      null,
    );
    assert.equal(
      provider.getDiagnostics()[0].extraction_schema_valid_count,
      null,
    );
    assert.equal(
      provider.getDiagnostics()[0].extraction_source_match_count,
      null,
    );
    assert.equal(provider.getDiagnostics()[1].repair_validation, "accepted");
  }
});

test("generalized repair keeps facts isolated to each trusted source subtree", async () => {
  const second = "https://luma.com/second-event";
  const firstCandidate = candidate();
  const secondCandidate = {
    ...candidate(second),
    title: { value: "Second Event", quote: "Second event evidence" },
  };
  const original = extractionResponse(
    JSON.stringify({
      result: {
        records: [
          { listing: firstCandidate, provider_note: "first" },
          { listing: secondCandidate, provider_note: "second" },
        ],
      },
    }),
    2,
  );
  const repaired = response(
    JSON.stringify({ candidates: [firstCandidate, secondCandidate] }),
    0,
  );
  const { provider, requests } = providerWithResponses([original, repaired]);
  const extracted = await provider.extract(
    { report, urls: [url, second], metadata: {} },
    selectSources([url, second], 3),
    options,
    signal,
  );
  assert.deepEqual(extracted.candidates, [firstCandidate, secondCandidate]);
  assert.equal(requests.length, 2);
  assert.equal(provider.getDiagnostics()[1].repair_validation, "accepted");
  assert.equal(provider.getDiagnostics()[1].repair_scalar_mismatch_count, 0);

  const crossed = response(
    JSON.stringify({
      candidates: [
        {
          ...firstCandidate,
          title: secondCandidate.title,
        },
        secondCandidate,
      ],
    }),
    0,
  );
  const { provider: crossedProvider } = providerWithResponses([
    (() => {
      const value = structuredClone(original);
      delete value.usage.server_tool_use.web_fetch_requests;
      return value;
    })(),
    crossed,
  ]);
  const partial = await crossedProvider.extract(
    { report, urls: [url, second], metadata: {} },
    selectSources([url, second], 3),
    options,
    signal,
  );
  assert.deepEqual(partial.candidates[0], { source_url: url });
  assert.deepEqual(partial.candidates[1], secondCandidate);
  assert.equal(
    partial.metadata.fetch_verification,
    "required_tool_and_source_coverage",
  );
  assert.equal(
    crossedProvider.getDiagnostics()[1].repair_validation,
    "accepted_partial",
  );
  assert.deepEqual(
    crossedProvider.getDiagnostics()[1].repair_scalar_mismatch_paths,
    ["candidates[0].title.value", "candidates[0].title.quote"],
  );
  assert.ok(!JSON.stringify(partial.candidates[0]).includes("Second Event"));
});

test("generalized repair fails closed for ambiguous multi-source JSON", async () => {
  const second = "https://luma.com/second-event";
  const body = JSON.stringify({
    result: {
      source_urls: [url, second],
      shared_candidate: candidate(),
    },
  });
  const { provider, requests } = providerWithResponses([
    extractionResponse(body, 2),
  ]);
  await assert.rejects(
    provider.extract(
      { report, urls: [url, second], metadata: {} },
      selectSources([url, second], 3),
      options,
      signal,
    ),
    { code: "invalid_extraction_shape" },
  );
  assert.equal(requests.length, 1);
  assert.equal(provider.getDiagnostics().length, 1);
});

test("strict legacy flat candidates normalize into the canonical schema", async () => {
  for (const [valid, rejected, expectedReason] of [
    [legacyFlatCandidate, legacyFlatRejection, "source_fetch_failed"],
    [alternateFlatCandidate, alternateFlatRejection, "source_page_cancelled"],
  ]) {
    const second = "https://luma.com/second-event";
    const sources = selectSources([url, second], 3);
    const value = extractionResponse(
      JSON.stringify([valid(), rejected(second)]),
    );
    delete value.usage.server_tool_use.web_fetch_requests;
    const { provider, requests } = providerWithResponses([value]);
    const extracted = await provider.extract(
      { report, urls: [url, second], metadata: {} },
      sources,
      options,
      signal,
    );
    assert.equal(requests.length, 1);
    assert.deepEqual(extracted.candidates[0].title, {
      value: "Founder Test",
      quote: report,
    });
    assert.deepEqual(extracted.candidates[0].organizer_name, {
      value: "Test Org",
      quote: report,
    });
    assert.deepEqual(extracted.candidates[0].address_line, {
      value: null,
      quote: null,
    });
    assert.deepEqual(extracted.candidates[1].source_verification, {
      status: "rejected",
      reason: expectedReason,
    });
    const [diagnostic] = provider.getDiagnostics();
    assert.equal(diagnostic.extraction_candidate_format, "legacy_flat");
    assert.equal(diagnostic.extraction_schema_valid_count, 2);
    assert.equal(diagnostic.extraction_source_match_count, 2);
    assert.equal(
      diagnostic.fetch_verification,
      "required_tool_and_source_coverage",
    );
  }
});

test("legacy flat compatibility rejects extra keys and inconsistent verdicts", async () => {
  const extra = { ...legacyFlatCandidate(), extra: "not allowed" };
  const inconsistent = legacyFlatRejection();
  inconsistent.title = "Invented";
  const alternateExtra = { ...alternateFlatCandidate(), extra: "not allowed" };
  const alternateInconsistent = alternateFlatRejection();
  alternateInconsistent.title = "Invented";
  for (const candidateValue of [
    extra,
    inconsistent,
    alternateExtra,
    alternateInconsistent,
  ]) {
    const value = extractionResponse(JSON.stringify([candidateValue]));
    delete value.usage.server_tool_use.web_fetch_requests;
    const invalidRepair = response(
      JSON.stringify({
        candidates: [{ ...candidate(), extra: "still invalid" }],
      }),
    );
    const { provider, requests } = providerWithResponses([
      value,
      invalidRepair,
    ]);
    await assert.rejects(
      provider.extract(
        { report, urls: [url], metadata: {} },
        selectSources([url], 3),
        options,
        signal,
      ),
      { code: "invalid_repair_output" },
    );
    const diagnostics = provider.getDiagnostics();
    assert.equal(requests.length, 2);
    assert.equal(diagnostics[0].extraction_candidate_format, "invalid");
    assert.equal(diagnostics[0].extraction_schema_valid_count, 0);
    assert.equal(diagnostics[1].phase, "repair");
    assert.ok(!JSON.stringify(diagnostics).includes("Invented"));
  }
});

test("strict legacy nested candidates normalize into the canonical schema", async () => {
  const second = "https://luma.com/second-event";
  const sources = selectSources([url, second], 3);
  const value = extractionResponse(
    JSON.stringify([legacyNestedCandidate(), legacyNestedRejection(second)]),
  );
  delete value.usage.server_tool_use.web_fetch_requests;
  const { provider } = providerWithResponses([value]);
  const extracted = await provider.extract(
    { report, urls: [url, second], metadata: {} },
    sources,
    options,
    signal,
  );
  assert.deepEqual(extracted.candidates[0].relevant_to_founders, {
    value: true,
    quote: report,
  });
  assert.deepEqual(extracted.candidates[0].venue_name, {
    value: null,
    quote: null,
  });
  assert.deepEqual(extracted.candidates[0].organizer_name, {
    value: "Test Org",
    quote: report,
  });
  assert.deepEqual(extracted.candidates[0].address_line, {
    value: null,
    quote: null,
  });
  assert.deepEqual(extracted.candidates[1].source_verification, {
    status: "rejected",
    reason: "source_fetch_failed",
  });
  const [diagnostic] = provider.getDiagnostics();
  assert.equal(diagnostic.extraction_candidate_format, "legacy_nested");
  assert.equal(diagnostic.extraction_schema_valid_count, 2);
  assert.equal(diagnostic.extraction_source_match_count, 2);
  assert.equal(
    diagnostic.fetch_verification,
    "required_tool_and_source_coverage",
  );
});

test("legacy nested compatibility rejects extra keys and inconsistent verdicts", async () => {
  const extra = { ...legacyNestedCandidate(), extra: "not allowed" };
  const inconsistent = legacyNestedRejection();
  inconsistent.title = { value: "Invented", quote: report };
  for (const candidateValue of [extra, inconsistent]) {
    const value = extractionResponse(JSON.stringify([candidateValue]));
    delete value.usage.server_tool_use.web_fetch_requests;
    const invalidRepair = response(
      JSON.stringify({
        candidates: [{ ...candidate(), extra: "still invalid" }],
      }),
    );
    const { provider, requests } = providerWithResponses([
      value,
      invalidRepair,
    ]);
    await assert.rejects(
      provider.extract(
        { report, urls: [url], metadata: {} },
        selectSources([url], 3),
        options,
        signal,
      ),
      { code: "invalid_repair_output" },
    );
    const diagnostics = provider.getDiagnostics();
    assert.equal(requests.length, 2);
    assert.equal(diagnostics[0].extraction_candidate_format, "invalid");
    assert.equal(diagnostics[0].extraction_schema_valid_count, 0);
    assert.equal(diagnostics[1].phase, "repair");
    assert.ok(!JSON.stringify(diagnostics).includes("Invented"));
  }
});

test("one tool-free repair call handles only a source-complete schema variant", async () => {
  const alternate = { ...candidate(), unexpected_wrapper_field: "remove me" };
  const first = extractionResponse(JSON.stringify({ candidates: [alternate] }));
  delete first.usage.server_tool_use.web_fetch_requests;
  const repaired = response(JSON.stringify({ candidates: [candidate()] }), 0);
  const { provider, requests } = providerWithResponses(
    [first, repaired],
    "openai/gpt-5.6-luna",
    "medium",
    "meta/muse-spark-1.3-contributor",
    "low",
  );
  const extracted = await provider.extract(
    { report, urls: [url], metadata: {} },
    selectSources([url], 3),
    options,
    signal,
  );
  assert.deepEqual(extracted.candidates, [candidate()]);
  assert.equal(extracted.metadata.requested_model, "openai/gpt-5.6-luna");
  assert.equal(extracted.metadata.repair_applied, true);
  assert.equal(
    extracted.metadata.repair.requested_model,
    "meta/muse-spark-1.3-contributor",
  );
  assert.equal(extracted.metadata.repair.requested_effort, "low");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.model, "meta/muse-spark-1.3-contributor");
  assert.deepEqual(requests[1].body.reasoning, {
    effort: "low",
    exclude: true,
  });
  assert.equal(requests[1].body.max_tokens, API_LIMITS.repairOutputTokens);
  assert.equal(requests[1].body.response_format.json_schema.strict, true);
  assert.ok(!("tools" in requests[1].body));
  assert.ok(!("tool_choice" in requests[1].body));
  const payload = JSON.parse(requests[1].body.messages[1].content);
  assert.deepEqual(payload.expected_source_urls, [url]);
  assert.match(payload.untrusted_candidate_json, /unexpected_wrapper_field/);
  assert.deepEqual(
    provider
      .getDiagnostics()
      .map((item) => [item.phase, item.requested_model, item.requested_effort]),
    [
      ["extraction", "openai/gpt-5.6-luna", "medium"],
      ["repair", "meta/muse-spark-1.3-contributor", "low"],
    ],
  );
  assert.equal(
    provider.getDiagnostics()[0].fetch_verification,
    "required_tool_and_source_coverage",
  );
  assert.equal(
    provider.getDiagnostics()[1].extraction_candidate_format,
    "canonical",
  );
  assert.equal(provider.getDiagnostics()[1].repair_validation, "accepted");
  assert.equal(provider.getDiagnostics()[1].repair_scalar_mismatch_count, 0);
  assert.deepEqual(
    provider.getDiagnostics()[1].repair_scalar_mismatch_paths,
    [],
  );

  const cancelledSource = extractionResponse(
    JSON.stringify({
      candidates: [
        {
          ...alternateFlatRejection(),
          unexpected_wrapper_field: "remove me",
        },
      ],
    }),
  );
  delete cancelledSource.usage.server_tool_use.web_fetch_requests;
  const cancelledRepair = response(
    JSON.stringify({
      candidates: [
        {
          ...candidate(),
          source_verification: {
            status: "rejected",
            reason: "source_page_cancelled",
          },
          relevant_to_founders: { value: null, quote: null },
          title: { value: null, quote: null },
          organizer_name: { value: null, quote: null },
          starts_at: { value: null, quote: null },
          ends_at: { value: null, quote: null },
          time_zone: { value: null, quote: null },
          venue_name: { value: null, quote: null },
          address_line: { value: null, quote: null },
          city: { value: null, quote: null },
          region: { value: null, quote: null },
          country_code: { value: null, quote: null },
          event_format: { value: null, quote: null },
          price_amount_cents: { value: null, quote: null },
          currency_code: { value: null, quote: null },
          registration_status: { value: null, quote: null },
        },
      ],
    }),
  );
  const { provider: cancelledProvider } = providerWithResponses([
    cancelledSource,
    cancelledRepair,
  ]);
  const cancelled = await cancelledProvider.extract(
    { report, urls: [url], metadata: {} },
    selectSources([url], 3),
    options,
    signal,
  );
  assert.equal(cancelled.candidates.length, 1);
  assert.equal(
    cancelledProvider.getDiagnostics()[1].repair_validation,
    "accepted",
  );
  assert.equal(
    cancelledProvider.getDiagnostics()[1].repair_scalar_mismatch_count,
    0,
  );

  const second = "https://luma.com/second-event";
  const partialSource = extractionResponse(
    JSON.stringify({
      candidates: [
        { ...candidate(), unexpected_wrapper_field: "remove me" },
        {
          ...candidate(second),
          unexpected_wrapper_field: "remove me too",
        },
      ],
    }),
  );
  delete partialSource.usage.server_tool_use.web_fetch_requests;
  const invalidSibling = {
    ...candidate(second),
    relevant_to_founders: { value: false, quote: report },
  };
  const partialRepair = response(
    JSON.stringify({ candidates: [candidate(), invalidSibling] }),
    0,
  );
  const { provider: partialProvider, requests: partialRequests } =
    providerWithResponses([partialSource, partialRepair]);
  const sources = selectSources([url, second], 3);
  const partial = await partialProvider.extract(
    { report, urls: [url, second], metadata: {} },
    sources,
    options,
    signal,
  );
  assert.equal(partial.candidates.length, 2);
  assert.equal(partialRequests.length, 2);
  assert.equal(
    partialProvider.getDiagnostics()[0].fetch_verification,
    "required_tool_and_source_coverage",
  );
  assert.equal(
    partialProvider.getDiagnostics()[1].repair_validation,
    "accepted_partial",
  );
  assert.equal(
    partialProvider.getDiagnostics()[1].repair_scalar_mismatch_count,
    0,
  );
  assert.deepEqual(
    partialProvider.getDiagnostics()[1].repair_scalar_mismatch_paths,
    [],
  );
  assert.equal(
    partialProvider.getDiagnostics()[1].extraction_schema_valid_count,
    1,
  );
  const repo = memoryRepository();
  const result = await runIngestion(options, {
    repository: repo,
    provider: {
      async research() {
        return { report, urls: [url, second], metadata: {} };
      },
      async extract() {
        return partial;
      },
    },
    signal,
    now: testNow,
  });
  assert.equal(result.status, "partial");
  assert.equal(result.events_written, 1);
  assert.equal(result.sources_unlinked, 1);
  assert.deepEqual(result.errors, ["invalid_candidate"]);
  assert.equal(repo.sources.get(second).event_id, null);
});

test("an invalid reported fetch count fails before spending a repair call", async () => {
  const alternate = { ...candidate(), unexpected_wrapper_field: "remove me" };
  const first = extractionResponse(
    JSON.stringify({ candidates: [alternate] }),
    0,
  );
  const { provider, requests } = providerWithResponses([first]);
  await assert.rejects(
    provider.extract(
      { report, urls: [url], metadata: {} },
      selectSources([url], 3),
      options,
      signal,
    ),
    { code: "source_fetch_incomplete" },
  );
  assert.equal(requests.length, 1);
  assert.equal(provider.getDiagnostics().length, 1);
});

test("repair isolates invented facts, preserves safe siblings, and never retries", async () => {
  const alternate = { ...candidate(), unexpected_wrapper_field: "remove me" };
  const original = extractionResponse(
    JSON.stringify({ candidates: [alternate] }),
  );
  for (const [repair, code] of [
    [
      response(
        JSON.stringify({
          candidates: [
            {
              ...candidate(),
              venue_name: { value: "Invented Place", quote: report },
            },
          ],
        }),
        0,
      ),
      "invalid_repair_output",
    ],
    [
      extractionResponse(JSON.stringify({ candidates: [candidate()] }), 1),
      "unexpected_repair_tools",
    ],
  ]) {
    const { provider, requests } = providerWithResponses([
      structuredClone(original),
      repair,
    ]);
    await assert.rejects(
      provider.extract(
        { report, urls: [url], metadata: {} },
        selectSources([url], 3),
        options,
        signal,
      ),
      { code },
    );
    assert.equal(requests.length, 2);
    const diagnostic = provider.getDiagnostics()[1];
    assert.equal(
      diagnostic.repair_validation,
      code === "unexpected_repair_tools"
        ? "unexpected_tool_use"
        : "scalar_preservation_failed",
    );
    assert.equal(
      diagnostic.repair_scalar_mismatch_count,
      code === "unexpected_repair_tools" ? null : 1,
    );
    assert.deepEqual(
      diagnostic.repair_scalar_mismatch_paths,
      code === "unexpected_repair_tools"
        ? null
        : ["candidates[0].venue_name.value"],
    );
    assert.ok(!JSON.stringify(provider.getDiagnostics()).includes("Invented"));
  }

  const second = "https://luma.com/second-event";
  const mixedOriginal = extractionResponse(
    JSON.stringify({
      candidates: [
        { ...candidate(), unexpected_wrapper_field: "remove this too" },
        { ...candidate(second), unexpected_wrapper_field: "remove me" },
      ],
    }),
  );
  delete mixedOriginal.usage.server_tool_use.web_fetch_requests;
  const mixedRepair = response(
    JSON.stringify({
      candidates: [
        {
          ...candidate(),
          venue_name: { value: "Invented Place", quote: report },
        },
        candidate(second),
      ],
    }),
    0,
  );
  const { provider: fallbackProvider, requests: fallbackRequests } =
    providerWithResponses([mixedOriginal, mixedRepair]);
  const sources = selectSources([url, second], 3);
  const extracted = await fallbackProvider.extract(
    { report, urls: [url, second], metadata: {} },
    sources,
    options,
    signal,
  );
  assert.equal(fallbackRequests.length, 2);
  assert.equal(extracted.metadata.repair_attempted, true);
  assert.equal(extracted.metadata.repair_applied, true);
  assert.equal(
    extracted.candidates[0].unexpected_wrapper_field,
    "remove this too",
  );
  assert.deepEqual(extracted.candidates[1], candidate(second));
  const fallbackDiagnostics = fallbackProvider.getDiagnostics();
  assert.equal(fallbackDiagnostics[0].extraction_schema_valid_count, 0);
  assert.equal(fallbackDiagnostics[1].extraction_schema_valid_count, 1);
  assert.equal(fallbackDiagnostics[1].repair_validation, "accepted_partial");
  assert.deepEqual(fallbackDiagnostics[1].repair_scalar_mismatch_paths, [
    "candidates[0].venue_name.value",
  ]);
  assert.ok(!JSON.stringify(extracted).includes("Invented"));
  assert.ok(!JSON.stringify(fallbackDiagnostics).includes("Invented"));

  const repo = memoryRepository();
  const result = await runIngestion(options, {
    repository: repo,
    provider: {
      async research() {
        return { report, urls: [url, second], metadata: {} };
      },
      async extract() {
        return extracted;
      },
    },
    signal,
    now: testNow,
  });
  assert.equal(result.status, "partial");
  assert.equal(result.events_written, 1);
  assert.equal(result.sources_unlinked, 1);
  assert.deepEqual(result.errors, ["invalid_candidate"]);

  const preservedOriginal = extractionResponse(
    JSON.stringify({
      candidates: [
        candidate(),
        { ...candidate(second), unexpected_wrapper_field: "remove me" },
      ],
    }),
  );
  delete preservedOriginal.usage.server_tool_use.web_fetch_requests;
  const whollyUnsafeRepair = response(
    JSON.stringify({
      candidates: [
        {
          ...candidate(),
          venue_name: { value: "Invented Place", quote: report },
        },
        {
          ...candidate(second),
          title: { value: "Invented Second Event", quote: report },
        },
      ],
    }),
    0,
  );
  const { provider: originalProvider } = providerWithResponses([
    preservedOriginal,
    whollyUnsafeRepair,
  ]);
  const originalsOnly = await originalProvider.extract(
    { report, urls: [url, second], metadata: {} },
    sources,
    options,
    signal,
  );
  assert.equal(originalsOnly.metadata.repair_applied, false);
  assert.deepEqual(originalsOnly.candidates[0], candidate());
  assert.equal(
    originalsOnly.candidates[1].unexpected_wrapper_field,
    "remove me",
  );
  assert.equal(
    originalProvider.getDiagnostics()[1].repair_validation,
    "scalar_preservation_failed",
  );
  assert.equal(
    originalProvider.getDiagnostics()[1].repair_scalar_mismatch_count,
    2,
  );
  assert.ok(!JSON.stringify(originalsOnly).includes("Invented"));
});

test("cancellation and network failures never retry or expose transport details", async () => {
  const controller = new AbortController();
  controller.abort();
  const { provider, requests } = providerWithResponses([]);
  await assert.rejects(
    provider.research(options, controller.signal),
    /run_cancelled/,
  );
  assert.equal(requests.length, 0);
  assert.deepEqual(provider.getDiagnostics(), []);
  const active = new AbortController();
  const cancelled = new OpenRouterSearchProvider(
    key,
    "openai/gpt-4.1",
    "low",
    async () => {
      active.abort();
      throw new Error(key);
    },
  );
  await assert.rejects(
    cancelled.research(options, active.signal),
    /run_cancelled/,
  );
  const failed = new OpenRouterSearchProvider(
    key,
    "openai/gpt-4.1",
    "low",
    async () => {
      throw new Error(key);
    },
  );
  await assert.rejects(
    failed.research(options, signal),
    /^IngestionError: provider_request_failed$/,
  );
});

test("OpenRouter results pass through draft validation and repeat-run deduplication", async () => {
  const repository = memoryRepository();
  for (let run = 0; run < 2; run++) {
    const { provider } = providerWithResponses([
      response(report, 1),
      extractionResponse(JSON.stringify({ candidates: [candidate()] })),
    ]);
    const summary = await runIngestion(options, {
      provider,
      repository,
      signal,
      now: testNow,
    });
    assert.equal(summary.status, "succeeded");
    assert.equal(summary.events_written, 1);
    assert.equal(summary.sources_created, run === 0 ? 1 : 0);
    assert.equal(repository.runs[run].metadata.research.provider, "openrouter");
  }
  assert.equal(repository.events.size, 1);
  assert.equal(repository.sources.size, 1);
  assert.equal(
    repository.sources.get(url).raw_payload.evidence_kind,
    "model_web_search_report_with_source_fetch",
  );
  assert.equal(
    repository.sources.get(url).raw_payload.extraction.fetch_tool_calls,
    1,
  );
  assert.ok(!JSON.stringify(repository.runs).includes(key));
});

test("a fetched-page conflict returns a fact-free rejection without creating an event", async () => {
  const { provider } = providerWithResponses([
    response(report, 1),
    extractionResponse(JSON.stringify({ candidates: [rejectedCandidate()] })),
  ]);
  const repository = memoryRepository();
  const summary = await runIngestion(options, {
    provider,
    repository,
    signal,
    now: testNow,
  });
  assert.equal(summary.status, "partial");
  assert.equal(summary.events_written, 0);
  assert.equal(summary.sources_unlinked, 1);
  assert.ok(summary.errors.includes("source_page_conflict"));
  assert.equal(
    repository.sources.get(url).last_attempt_error,
    "source_page_conflict",
  );
});

test("only annotated URLs can become drafts; an empty search skips extraction", async () => {
  const search = response(report + " https://luma.com/invented", 1);
  search.choices[0].message.annotations = [];
  const { provider, requests } = providerWithResponses([search]);
  const repository = memoryRepository();
  const summary = await runIngestion(options, {
    provider,
    repository,
    signal,
    now: testNow,
  });
  assert.equal(summary.status, "succeeded");
  assert.equal(summary.events_written, 0);
  assert.equal(requests.length, 1);
});

test("only cited listing URLs named in the report are selected, in report order", async () => {
  const second = "https://luma.com/second-event";
  const background = "https://meetup.com/group/events/123";
  const unannotated = "https://luma.com/unannotated";
  const text = `### 1. Second\n${second}\n### 2. First\n${url}\n### 3. Unsupported\n${unannotated}`;
  const value = response(text, 1);
  value.choices[0].message.annotations = [
    { type: "url_citation", url_citation: { url: background } },
    { type: "url_citation", url_citation: { url } },
    { type: "url_citation", url_citation: { url: second } },
  ];
  const { provider } = providerWithResponses([value]);
  const research = await provider.research(options, signal);
  assert.deepEqual(research.urls, [second, url]);
});

test("one primary cited listing per numbered event prevents duplicate-platform slots", async () => {
  const duplicate = "https://eventbrite.com/e/founder-test-tickets-123";
  const second = "https://luma.com/second-event";
  const text = [
    `### 1. Founder Test\nPrimary: ${url}\nDuplicate: ${duplicate}`,
    `### 2. Second Event\nPrimary: ${second}`,
  ].join("\n\n");
  const value = response(text, 1);
  value.choices[0].message.annotations = [url, duplicate, second].map(
    (citationUrl) => ({
      type: "url_citation",
      url_citation: { url: citationUrl },
    }),
  );
  const research = await providerWithResponses([value]).provider.research(
    options,
    signal,
  );
  assert.deepEqual(research.urls, [url, second]);
});

test("request timeout is bounded and invalid HTTP JSON fails safely", async (t) => {
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    assert.equal(milliseconds, 120000);
    return AbortSignal.abort();
  });
  const timed = new OpenRouterSearchProvider(
    key,
    "openai/gpt-4.1",
    "low",
    async (_url, init) => {
      assert.equal(init.signal.aborted, true);
      throw new Error(key);
    },
  );
  await assert.rejects(
    timed.research(options, signal),
    /provider_request_timeout/,
  );
  t.mock.restoreAll();
  const badJson = new OpenRouterSearchProvider(
    key,
    "openai/gpt-4.1",
    "low",
    async () => new Response("not JSON " + key),
  );
  await assert.rejects(
    badJson.research(options, signal),
    /^IngestionError: invalid_provider_response$/,
  );
});

test("missing extraction billing fields stay unknown when fetch usage is verified", async () => {
  const value = extractionResponse(
    JSON.stringify({ candidates: [candidate()] }),
  );
  value.usage = { server_tool_use: { web_fetch_requests: 1 } };
  value.choices[0].message.tool_calls = null;
  value.choices[0].message.annotations = null;
  const { provider } = providerWithResponses([value]);
  const extracted = await provider.extract(
    { report, urls: [url], metadata: {} },
    selectSources([url], 3),
    options,
    signal,
  );
  assert.deepEqual(extracted.metadata.usage, {
    input_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    total_tokens: null,
    cost: null,
  });
  assert.equal(extracted.metadata.search_tool_calls, null);
  assert.equal(extracted.metadata.fetch_tool_calls, 1);
});

test("reasoning-token usage is allowlisted without inferring missing or malformed values", async () => {
  for (const [reasoningTokens, expected] of [
    [7, 7],
    [null, null],
    [-1, null],
    ["7", null],
    [0.5, null],
  ]) {
    const value = response(report, 1);
    if (reasoningTokens !== null)
      value.usage.completion_tokens_details = {
        reasoning_tokens: reasoningTokens,
        private_trace: key,
      };
    const { provider } = providerWithResponses(
      [value],
      "openai/gpt-4.1",
      "high",
    );
    const research = await provider.research(options, signal);
    assert.equal(research.metadata.requested_effort, "high");
    assert.equal(research.metadata.usage.reasoning_tokens, expected);
    const [diagnostic] = provider.getDiagnostics();
    assert.equal(diagnostic.requested_effort, "high");
    assert.equal(diagnostic.usage.reasoning_tokens, expected);
    assert.ok(!JSON.stringify([research.metadata, diagnostic]).includes(key));
  }
});

test("source fetch verification requires one bounded fetch per selected listing", async () => {
  const second = "https://luma.com/second-event";
  const sources = selectSources([url, second], 3);
  const complete = JSON.stringify({
    candidates: [candidate(), rejectedCandidate(second)],
  });
  const cases = [
    [0, "source_fetch_incomplete"],
    [1, "source_fetch_incomplete"],
    [3, "source_fetch_limit_exceeded"],
    [11, "source_fetch_limit_exceeded"],
  ];
  for (const [fetches, expected] of cases) {
    const value = extractionResponse(complete, fetches);
    const { provider, requests } = providerWithResponses([value]);
    await assert.rejects(
      provider.extract(
        { report, urls: [url], metadata: {} },
        sources,
        options,
        signal,
      ),
      { code: expected },
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.tools[0].parameters.max_uses, 2);
    assert.equal(requests[0].body.max_tool_calls, 2);
  }
  const valid = extractionResponse(complete, 2);
  const { provider } = providerWithResponses([valid]);
  const extracted = await provider.extract(
    { report, urls: [url], metadata: {} },
    sources,
    options,
    signal,
  );
  assert.equal(extracted.candidates.length, 2);
  assert.equal(extracted.metadata.fetch_tool_calls, 2);
  assert.equal(provider.getDiagnostics()[0].fetch_usage, "reported");
  assert.equal(provider.getDiagnostics()[0].fetch_tool_calls, 2);
});

test("complete source verdicts safely bridge a missing fetch counter", async () => {
  const second = "https://luma.com/second-event";
  const sources = selectSources([url, second], 3);
  const value = extractionResponse(
    JSON.stringify({
      candidates: [candidate(), rejectedCandidate(second)],
    }),
  );
  delete value.usage.server_tool_use.web_fetch_requests;
  const { provider, requests } = providerWithResponses([value]);
  const extracted = await provider.extract(
    { report, urls: [url, second], metadata: {} },
    sources,
    options,
    signal,
  );
  assert.equal(requests[0].body.tool_choice, "required");
  assert.equal(requests[0].body.max_tool_calls, 2);
  assert.equal(extracted.candidates.length, 2);
  assert.equal(extracted.metadata.fetch_tool_calls, null);
  assert.equal(
    extracted.metadata.fetch_verification,
    "required_tool_and_source_coverage",
  );
  const [diagnostic] = provider.getDiagnostics();
  assert.equal(diagnostic.fetch_usage, "missing");
  assert.equal(
    diagnostic.fetch_verification,
    "required_tool_and_source_coverage",
  );
});

test("missing fetch counters safely diagnose partial, invalid, duplicate and untrusted coverage", async () => {
  const second = "https://luma.com/second-event";
  const sources = selectSources([url, second], 3);
  const malformed = { ...candidate(), title: "not-a-fact" };
  for (const [candidates, expected, counts] of [
    [
      [candidate()],
      "invalid_extraction_shape",
      { valid: 1, matched: 1, duplicates: 0, untrusted: 0 },
    ],
    [
      [malformed, rejectedCandidate(second)],
      "invalid_repair_output",
      { valid: 1, matched: 2, duplicates: 0, untrusted: 0 },
    ],
    [
      [candidate(), candidate()],
      "source_fetch_usage_missing",
      { valid: 2, matched: 1, duplicates: 1, untrusted: 0 },
    ],
    [
      [candidate(), rejectedCandidate("https://luma.com/untrusted")],
      "source_fetch_usage_missing",
      { valid: 2, matched: 1, duplicates: 0, untrusted: 1 },
    ],
  ]) {
    const value = extractionResponse(JSON.stringify({ candidates }));
    delete value.usage.server_tool_use.web_fetch_requests;
    const repairable = expected === "invalid_repair_output";
    const responses = [value];
    if (repairable) {
      responses.push(
        response(
          JSON.stringify({
            candidates: [{ ...candidate(), extra: "still invalid" }],
          }),
        ),
      );
    }
    const { provider, requests } = providerWithResponses(responses);
    const extracting = provider.extract(
      { report, urls: [url, second], metadata: {} },
      sources,
      options,
      signal,
    );
    if (repairable) {
      const extracted = await extracting;
      assert.deepEqual(extracted.candidates, candidates);
      assert.equal(
        extracted.metadata.repair.error_code,
        "invalid_repair_output",
      );
    } else await assert.rejects(extracting, { code: expected });
    const diagnostic = provider.getDiagnostics()[0];
    assert.equal(
      diagnostic.fetch_verification,
      repairable ? "required_tool_and_source_coverage" : undefined,
    );
    assert.equal(diagnostic.extraction_schema_valid_count, counts.valid);
    assert.equal(diagnostic.extraction_source_match_count, counts.matched);
    assert.equal(
      diagnostic.extraction_duplicate_source_count,
      counts.duplicates,
    );
    assert.equal(
      diagnostic.extraction_untrusted_source_count,
      counts.untrusted,
    );
    assert.equal(requests.length, repairable ? 2 : 1);
    if (repairable) assert.equal(provider.getDiagnostics()[1].phase, "repair");
    assert.ok(!JSON.stringify(diagnostic).includes(url));
    assert.ok(!JSON.stringify(diagnostic).includes(second));
  }
});

test("malformed source fetch counters are rejected and diagnosed safely", async () => {
  for (const fetches of [-1, "1", 0.5]) {
    const value = extractionResponse(
      JSON.stringify({ candidates: [candidate()] }),
      fetches,
    );
    const { provider } = providerWithResponses([value]);
    await assert.rejects(
      provider.extract(
        { report, urls: [url], metadata: {} },
        selectSources([url], 3),
        options,
        signal,
      ),
      { code: "invalid_provider_response" },
    );
    const [diagnostic] = provider.getDiagnostics();
    assert.equal(diagnostic.fetch_usage, "invalid");
    assert.equal(diagnostic.fetch_tool_calls, null);
  }
});

test("bounded provider citations safely bridge a missing search counter", async () => {
  for (const missing of ["usage", "tool_usage", "counter", "null_counter"]) {
    const value = response(report, 1);
    if (missing === "usage") delete value.usage;
    if (missing === "tool_usage") delete value.usage.server_tool_use;
    if (missing === "counter")
      delete value.usage.server_tool_use.web_search_requests;
    if (missing === "null_counter")
      value.usage.server_tool_use.web_search_requests = null;
    const { provider, requests } = providerWithResponses([
      value,
      extractionResponse(JSON.stringify({ candidates: [candidate()] })),
    ]);
    const repository = memoryRepository();
    const progress = [];
    const summary = await runIngestion(options, {
      provider,
      repository,
      signal,
      now: testNow,
      onProgress: async (snapshot) => progress.push(snapshot),
    });
    assert.equal(summary.status, "succeeded");
    assert.deepEqual(summary.errors, []);
    assert.equal(requests.length, 2);
    assert.equal(repository.events.size, 1);
    assert.equal(repository.sources.size, 1);
    const [diagnostic] = summary.provider_diagnostics;
    assert.equal(diagnostic.response_id, "gen-offline-test");
    assert.equal(diagnostic.model, "openai/gpt-4.1");
    assert.equal(diagnostic.http_status, 200);
    assert.equal(diagnostic.finish_reason, "stop");
    assert.equal(diagnostic.search_usage, "missing");
    assert.equal(diagnostic.search_tool_calls, null);
    assert.equal(diagnostic.search_verification, "bounded_citations");
    assert.equal(repository.runs[0].metadata.research.search_tool_calls, null);
    assert.equal(
      repository.runs[0].metadata.research.search_verification,
      "bounded_citations",
    );
    assert.equal(diagnostic.citation_count, 1);
    assert.equal(
      diagnostic.content_characters,
      value.choices[0].message.content.length,
    );
    assert.equal(diagnostic.usage.cost, missing === "usage" ? null : 0.001);
    assert.equal(
      diagnostic.usage.input_tokens,
      missing === "usage" ? null : 10,
    );
    assert.deepEqual(
      progress.at(-1).provider_diagnostics,
      summary.provider_diagnostics,
    );
    assert.deepEqual(
      repository.runs[0].metadata.summary.provider_diagnostics,
      summary.provider_diagnostics,
    );
    assert.ok(!JSON.stringify([summary, progress]).includes(report));
    assert.equal(
      repository.runs[0].metadata.research_report,
      value.choices[0].message.content,
    );
    assert.ok(!JSON.stringify(summary).includes(key));
  }
});

test("citation fallback requires bounded, supported listing URLs", async () => {
  const cases = [
    [[], "search_usage_missing"],
    [
      [
        {
          type: "url_citation",
          url_citation: { url: "https://example.com/event" },
        },
      ],
      "invalid_search_citation",
    ],
    [
      [
        {
          type: "url_citation",
          url_citation: { url: "http://luma.com/event" },
        },
      ],
      "invalid_search_citation",
    ],
    [
      [
        {
          type: "url_citation",
          url_citation: { url: "https://luma.com/discover" },
        },
      ],
      "invalid_search_citation",
    ],
    [
      Array(16).fill({ type: "url_citation", url_citation: { url } }),
      "search_result_limit_exceeded",
    ],
  ];
  for (const [annotations, expected] of cases) {
    const value = response(report, 1);
    delete value.usage.server_tool_use;
    value.choices[0].message.annotations = annotations;
    const { provider, requests } = providerWithResponses([value]);
    await assert.rejects(provider.research(options, signal), {
      code: expected,
    });
    assert.equal(requests.length, 1);
    assert.equal(provider.getDiagnostics()[0].search_verification, undefined);
  }
  const mixed = response(report, 1);
  delete mixed.usage.server_tool_use;
  mixed.choices[0].message.annotations.unshift({
    type: "url_citation",
    url_citation: { url: "https://example.com/background" },
  });
  const { provider } = providerWithResponses([mixed]);
  const research = await provider.research(options, signal);
  assert.deepEqual(
    selectSources(research.urls, 3).map((source) => source.source_url),
    [url],
  );
});

test("zero and invalid search counters stay distinct without authorizing ingestion", async () => {
  for (const [searches, expected, state] of [
    [0, "search_not_performed", "reported"],
    [-1, "invalid_provider_response", "invalid"],
    ["1", "invalid_provider_response", "invalid"],
    [0.5, "invalid_provider_response", "invalid"],
    [4, "search_tool_limit_exceeded", "reported"],
  ]) {
    const { provider, requests } = providerWithResponses([
      response(report, searches),
    ]);
    const repository = memoryRepository();
    const summary = await runIngestion(options, {
      provider,
      repository,
      signal,
      now: testNow,
    });
    assert.deepEqual(summary.errors, [expected]);
    assert.equal(summary.provider_diagnostics[0].search_usage, state);
    assert.equal(
      summary.provider_diagnostics[0].search_tool_calls,
      state === "reported" ? searches : null,
    );
    assert.equal(summary.provider_diagnostics[0].usage.cost, 0.001);
    assert.equal(repository.events.size, 0);
    assert.equal(requests.length, 1);
  }
});

test("rejected completed responses retain usage even when their structure or content fails validation", async () => {
  const incomplete = response(report, 1);
  incomplete.choices[0].finish_reason = "length";
  const malformed = response(report, 1);
  malformed.choices = [];
  const refused = response(report, 1);
  refused.choices[0].message.refusal = key;
  for (const value of [incomplete, malformed, refused, response("", 1)]) {
    const { provider } = providerWithResponses([value]);
    await assert.rejects(provider.research(options, signal));
    const [diagnostic] = provider.getDiagnostics();
    assert.equal(diagnostic.response_id, "gen-offline-test");
    assert.equal(diagnostic.usage.cost, 0.001);
    assert.equal(diagnostic.search_tool_calls, 1);
    assert.ok(!JSON.stringify(diagnostic).includes(key));
    assert.ok(!JSON.stringify(diagnostic).includes(report));
  }
});

test("failed extraction and finalization preserve both requests in the recovery checkpoint", async () => {
  for (const failFinish of [false, true]) {
    const research = response(report, 1);
    const extraction = extractionResponse("bad JSON " + key);
    extraction.id = "gen-extraction";
    extraction.usage.cost = 0.002;
    const { provider, requests } = providerWithResponses([
      research,
      extraction,
    ]);
    const repository = memoryRepository();
    if (failFinish)
      repository.finish = async () => {
        throw new IngestionError("run_finish_failed");
      };
    const progress = [];
    const running = runIngestion(options, {
      provider,
      repository,
      signal,
      now: testNow,
      onProgress: async (snapshot) => progress.push(snapshot),
    });
    if (failFinish) await assert.rejects(running, /run_finish_failed/);
    else assert.equal((await running).status, "partial");
    const snapshot = progress.at(-1);
    assert.ok(snapshot.errors.includes("invalid_extraction_json"));
    assert.deepEqual(
      snapshot.provider_diagnostics.map((item) => item.phase),
      ["research", "extraction"],
    );
    assert.deepEqual(
      snapshot.provider_diagnostics.map((item) => item.usage.cost),
      [0.001, 0.002],
    );
    assert.equal(
      snapshot.provider_diagnostics[1].response_id,
      "gen-extraction",
    );
    assert.equal(requests.length, 2);
    assert.equal(snapshot.provider_diagnostics[0].structured_output, null);
    assert.equal(
      snapshot.provider_diagnostics[1].structured_output.format,
      "text",
    );
    assert.equal(
      snapshot.provider_diagnostics[1].structured_output.parse_status,
      "invalid",
    );
    assert.ok(!JSON.stringify(snapshot).includes(key));
    assert.equal(repository.events.size, 0);
  }
});

test("JSON fence diagnostics do not enable repair, writes, retries, or raw-content retention", async () => {
  const sourceText = "PRIVATE_FENCE_CONTENT";
  const wrapped =
    "```json\n" +
    JSON.stringify({ candidates: [candidate()], sourceText, credential: key }) +
    "\n```";
  const { provider, requests } = providerWithResponses([
    response(report, 1),
    extractionResponse(wrapped),
  ]);
  const repository = memoryRepository();
  const progress = [];
  const summary = await runIngestion(options, {
    provider,
    repository,
    signal,
    now: testNow,
    onProgress: async (value) => progress.push(value),
  });
  assert.equal(summary.status, "partial");
  assert.deepEqual(summary.errors, ["invalid_extraction_json"]);
  assert.equal(summary.events_written, 0);
  assert.equal(requests.length, 2);
  const structured = summary.provider_diagnostics[1].structured_output;
  assert.equal(structured.parse_status, "invalid");
  assert.equal(structured.format, "single_code_fence");
  assert.equal(structured.fence_json_valid, true);
  assert.deepEqual(
    repository.runs[0].metadata.summary.provider_diagnostics[1]
      .structured_output,
    structured,
  );
  assert.equal(
    repository.sources.get(url).last_attempt_error,
    "invalid_extraction_json",
  );
  assert.equal(repository.events.size, 0);
  assert.doesNotMatch(
    JSON.stringify([summary, progress, repository.runs]),
    /PRIVATE_FENCE_CONTENT|offline-test-not-a-key|credential/,
  );
  assert.equal(provider.getDiagnostics().length, 2);
});

test("malformed repair responses are classified without changing repair failure behavior", async () => {
  const alternate = { ...candidate(), unexpected_wrapper_field: "remove me" };
  const extraction = extractionResponse(
    JSON.stringify({ candidates: [alternate] }),
  );
  delete extraction.usage.server_tool_use.web_fetch_requests;
  const repair = response(
    "```json\n" +
      JSON.stringify({ candidates: [candidate()], secret: key }) +
      "\n```",
  );
  const { provider, requests } = providerWithResponses([extraction, repair]);
  await assert.rejects(
    provider.extract(
      { report, urls: [url], metadata: {} },
      selectSources([url], 3),
      options,
      signal,
    ),
    { code: "invalid_repair_json" },
  );
  assert.equal(requests.length, 2);
  const diagnostics = provider.getDiagnostics();
  assert.equal(diagnostics[0].structured_output.format, "json_object");
  assert.equal(diagnostics[1].repair_validation, "invalid_json");
  assert.equal(diagnostics[1].structured_output.format, "single_code_fence");
  assert.equal(diagnostics[1].structured_output.fence_json_valid, true);
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /offline-test-not-a-key|secret|Founder Test/,
  );
});

test("diagnostics allowlist excludes reflected credentials, free text, URLs and invalid numbers", async () => {
  const value = response(key, 1);
  value.id = "gen-" + key;
  value.model = "vendor/" + key;
  value.choices[0].finish_reason = key;
  value.usage.cost = -2;
  value.usage.prompt_tokens = "secret " + key;
  value.usage.private_details = { secret: key };
  value.choices[0].message.annotations[0].url_citation.url =
    "https://example.com/" + key;
  const { provider } = providerWithResponses([value]);
  await assert.rejects(
    provider.research(options, signal),
    /invalid_provider_response/,
  );
  const [diagnostic] = provider.getDiagnostics();
  assert.equal(diagnostic.response_id, null);
  assert.equal(diagnostic.model, null);
  assert.equal(diagnostic.finish_reason, null);
  assert.equal(diagnostic.usage.cost, null);
  assert.equal(diagnostic.usage.input_tokens, null);
  assert.equal(diagnostic.usage.output_tokens, 20);
  const serialized = JSON.stringify(diagnostic);
  for (const forbidden of [key, "private_details", "https://", "secret "])
    assert.ok(!serialized.includes(forbidden));
});

test("HTTP, JSON and transport failures keep costs unknown and never store raw errors", async () => {
  for (const [fetcher, status, expected] of [
    [
      async () => new Response(key, { status: 402 }),
      402,
      "provider_quota_or_rate_limit",
    ],
    [
      async () => new Response(key, { status: 200 }),
      200,
      "invalid_provider_response",
    ],
    [
      async () => {
        throw new Error(key);
      },
      null,
      "provider_request_failed",
    ],
  ]) {
    const provider = new OpenRouterSearchProvider(
      key,
      "openai/gpt-4.1",
      "low",
      fetcher,
    );
    const repository = memoryRepository();
    const summary = await runIngestion(options, {
      provider,
      repository,
      signal,
      now: testNow,
    });
    assert.deepEqual(summary.errors, [expected]);
    const [diagnostic] = summary.provider_diagnostics;
    assert.equal(diagnostic.http_status, status);
    assert.equal(diagnostic.usage.cost, null);
    assert.equal(diagnostic.response_id, null);
    assert.ok(!JSON.stringify(summary).includes(key));
  }
});

test("a diagnostics or progress hook failure cannot leave the run open or erase usage", async () => {
  for (const hook of ["diagnostics", "progress"]) {
    const { provider } = providerWithResponses([response(report, 0)]);
    if (hook === "diagnostics")
      provider.getDiagnostics = () => {
        throw new Error(key);
      };
    const repository = memoryRepository();
    const summary = await runIngestion(options, {
      provider,
      repository,
      signal,
      now: testNow,
      onProgress: async () => {
        if (hook === "progress") throw new Error(key);
      },
    });
    assert.equal(repository.runs[0].summary.status, "failed");
    assert.ok(
      summary.errors.includes(
        hook === "diagnostics"
          ? "provider_diagnostics_unavailable"
          : "progress_write_failed",
      ),
    );
    if (hook === "progress")
      assert.equal(
        repository.runs[0].metadata.summary.provider_diagnostics[0].usage.cost,
        0.001,
      );
    assert.ok(!JSON.stringify(repository.runs).includes(key));
  }
});
