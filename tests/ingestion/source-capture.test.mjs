import assert from "node:assert/strict";
import test from "node:test";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  captureSourcePage,
  isPublicCaptureAddress,
  captureFailureDetails,
} from "../../lib/ingestion/source-capture.ts";
import {
  extractSourceText,
  sourceRetrievalUrl,
  validateCapturedPages,
  safeCaptureDiagnostics,
  SOURCE_CAPTURE_LIMITS,
} from "../../lib/ingestion/source-page.ts";
import { sourceIdentity } from "../../lib/ingestion/sources.ts";
import { OpenRouterSearchProvider } from "../../lib/ingestion/openrouter-provider.ts";
import { runIngestion } from "../../lib/ingestion/run.ts";
import { readCareerTarget } from "../../lib/career/profile.ts";
import { normalizeCandidate } from "../../lib/ingestion/normalize.ts";
import { SqliteIngestionRepository } from "../../lib/ingestion/sqlite-repository.ts";
import { openSqliteDatabase } from "../../lib/storage/sqlite.ts";
import {
  runInspectionCli,
  executeSqliteInspection,
} from "../../lib/ingestion/inspection.ts";
import { executeSqliteReview } from "../../lib/review/repository.ts";
import { buildReviewReport } from "../../lib/review/report.ts";
import { loadDashboard } from "../../lib/dashboard/repository.ts";
import {
  outputSchemaForProfile,
  schemaForProfile,
} from "../../lib/career/contracts.ts";
import { createClient } from "@supabase/supabase-js";
import { SupabaseIngestionRepository } from "../../lib/ingestion/repository.ts";
import {
  candidate,
  report,
  url,
  options,
  fact,
  memoryRepository,
} from "./helpers.mjs";

const signal = new AbortController().signal;
const now = () => new Date("2026-09-01T00:00:00Z");
const dns = async () => [{ address: "93.184.216.34", family: 4 }];
const source = sourceIdentity(url);
const finosUrl = "https://finos.org/hosted-events/audit-example";
const finos = sourceIdentity(finosUrl);
const productCircleUrl =
  "https://productcircle.co/events/new-york-november-2026";
const productCircle = sourceIdentity(productCircleUrl);
const digest = (text) => createHash("sha256").update(text).digest("hex");
const page = (text = report, sourceUrl = url) => ({
  evidence_kind: "source_page_text_v1",
  source_url: sourceUrl,
  retrieval_url: sourceUrl,
  final_url: sourceUrl,
  fetched_at: now().toISOString(),
  http_status: 200,
  content_type: "text/html",
  response_bytes: Buffer.byteLength(text),
  redirects: 0,
  body_hash: digest(text),
  text_hash: digest(text),
  text,
});
function response(body = report, status = 200, headers = {}) {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
    body: Buffer.from(body),
  };
}
function router(content, tools) {
  return new Response(
    JSON.stringify({
      id: "offline-page-extraction",
      model: "vendor/offline",
      choices: [
        { finish_reason: "stop", message: { role: "assistant", content } },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 10,
        total_tokens: 20,
        ...(tools ? { server_tool_use: tools } : {}),
      },
    }),
  );
}
const target = await readCareerTarget();
const careerOptions = {
  ...options,
  profile: "career",
  searches: 3,
  career_target: target,
};
function careerCandidate(text) {
  const c = candidate();
  c.relevant_to_founders = fact(null);
  c.price_amount_cents = fact(null);
  c.currency_code = fact(null);
  c.career = {
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
  assert.ok(text.includes(c.career.kind.quote));
  return c;
}

test("captured founder and career runs preserve escaped model quotes with private normalization provenance", async () => {
  const exact =
    'eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode';
  const text = report + " Product discovery discussion.\n" + exact + '"';
  for (const profile of ["founder", "career"]) {
    const c = profile === "career" ? careerCandidate(text) : candidate();
    c.event_format = fact("in-person", JSON.stringify(exact).slice(1, -1));
    const original = structuredClone(c);
    const repo = memoryRepository();
    let calls = 0;
    const provider = new OpenRouterSearchProvider(
      "fake-key",
      "vendor/offline",
      "medium",
      async () => {
        calls += 1;
        return router(JSON.stringify({ candidates: [c] }));
      },
    );
    provider.research = async () => ({ report, urls: [url], metadata: {} });
    const summary = await runIngestion(
      profile === "career" ? careerOptions : options,
      {
        provider,
        repository: repo,
        signal,
        now,
        captureSource: async () => page(text),
      },
    );
    assert.equal(summary.status, "succeeded");
    assert.equal(summary.events_written, 1);
    assert.equal(calls, 1);
    const saved = repo.sources.get(url);
    assert.deepEqual(saved.raw_payload.candidate, original);
    assert.deepEqual(saved.raw_payload.normalization_notes, [
      "event_format_quote_json_escape_normalized",
    ]);
    assert.equal(saved.content_text, text);
  }
});

test("gateway format enums are canonical for both profiles while runtime inputs retain historical compatibility", () => {
  for (const profile of ["founder", "career"]) {
    const c =
      profile === "career"
        ? careerCandidate(report + " Product discovery discussion.")
        : candidate();
    for (const value of ["in-person", "hybrid", "virtual"]) {
      c.event_format.value = value;
      assert.equal(outputSchemaForProfile(profile).safeParse(c).success, true);
    }
    c.event_format = fact(null);
    assert.equal(outputSchemaForProfile(profile).safeParse(c).success, true);
    for (const value of ["in_person", "physical", "online", "", "unknown"]) {
      c.event_format = fact(value);
      assert.equal(outputSchemaForProfile(profile).safeParse(c).success, false);
      if (value === "in_person")
        assert.equal(schemaForProfile(profile).safeParse(c).success, true);
    }
  }
});

test("captured founder and career runs normalize grounded format and Eastern aliases without repair or changing private scalars", async () => {
  const text = report + " Product discovery discussion.";
  for (const profile of ["founder", "career"]) {
    const c = profile === "career" ? careerCandidate(text) : candidate();
    c.event_format.value = "in_person";
    c.time_zone = fact("EDT", "6 PM EDT");
    const repo = memoryRepository();
    let calls = 0;
    const provider = new OpenRouterSearchProvider(
      "fake-key",
      "vendor/offline",
      "medium",
      async () => {
        calls += 1;
        return router(JSON.stringify({ candidates: [c] }));
      },
    );
    const summary = await runIngestion(
      profile === "career" ? careerOptions : options,
      {
        provider: {
          async research() {
            return { report: "Sparse discovery", urls: [url], metadata: {} };
          },
          extract: provider.extract.bind(provider),
          getDiagnostics: provider.getDiagnostics.bind(provider),
        },
        repository: repo,
        signal,
        now,
        captureSource: async () => page(text),
      },
    );
    assert.equal(calls, 1);
    assert.equal(summary.status, "succeeded");
    assert.equal(summary.events_written, 1);
    assert.equal([...repo.events.values()][0].event_format, "in-person");
    assert.equal([...repo.events.values()][0].time_zone, "America/New_York");
    assert.deepEqual(
      repo.sources.get(url).raw_payload.candidate.time_zone,
      c.time_zone,
    );
    assert.equal(
      repo.sources.get(url).raw_payload.candidate.event_format.value,
      "in_person",
    );
    assert.equal(
      repo.sources.get(url).raw_payload.candidate.event_format.quote,
      c.event_format.quote,
    );
    assert.deepEqual(repo.sources.get(url).raw_payload.normalization_notes, [
      "timezone_normalized_eastern",
      "event_format_normalized_in_person",
    ]);
  }
});

test("extraction and repair requests constrain format values for both profiles without relaxing scalar preservation", async () => {
  const text = report + " Product discovery discussion.";
  for (const profile of ["founder", "career"]) {
    const c = profile === "career" ? careerCandidate(text) : candidate();
    const bodies = [];
    const provider = new OpenRouterSearchProvider(
      "fake-key",
      "vendor/offline",
      "medium",
      async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return router(
          JSON.stringify(
            bodies.length === 1
              ? [{ ...c, unfamiliar: null }]
              : { candidates: [c] },
          ),
        );
      },
    );
    await provider.extract(
      { report, urls: [url], metadata: {}, source_pages: [page(text)] },
      [source],
      profile === "career" ? careerOptions : options,
      signal,
    );
    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      const schema =
        body.response_format.json_schema.schema.properties.candidates.items
          .properties.event_format.properties.value;
      assert.deepEqual(schema.anyOf, [
        { type: "string", enum: ["in-person", "hybrid", "virtual"] },
        { type: "null" },
      ]);
      assert.ok(body.messages[0].content.includes(JSON.stringify(schema)));
    }
  }
  const c = candidate();
  c.event_format.value = "in_person";
  const changed = structuredClone(c);
  changed.event_format.value = "in-person";
  let calls = 0;
  const provider = new OpenRouterSearchProvider(
    "fake-key",
    "vendor/offline",
    "medium",
    async () => {
      calls += 1;
      return router(
        JSON.stringify(
          calls === 1
            ? [{ ...c, unfamiliar: null }]
            : { candidates: [changed] },
        ),
      );
    },
  );
  await assert.rejects(
    provider.extract(
      { report, urls: [url], metadata: {}, source_pages: [page()] },
      [source],
      options,
      signal,
    ),
    { code: "invalid_repair_output" },
  );
  assert.equal(calls, 2);
  assert.equal(
    provider.getDiagnostics()[1].repair_validation,
    "scalar_preservation_failed",
  );
  assert.ok(
    provider
      .getDiagnostics()[1]
      .repair_scalar_mismatch_paths.includes(
        "candidates[0].event_format.value",
      ),
  );
});

test("capture retrieval preserves cited hosts and strips secrets without changing source identity", () => {
  assert.equal(
    sourceRetrievalUrl(
      "https://www.finos.org/hosted-events/audit-example?token=PRIVATE&utm_source=x#fragment",
      finos,
    ),
    "https://www.finos.org/hosted-events/audit-example",
  );
  const pmi = sourceIdentity("https://pminyc.org/calendar?eventId=42");
  assert.equal(
    sourceRetrievalUrl(
      "https://www.pminyc.org/calendar?eventId=42&token=PRIVATE",
      pmi,
    ),
    "https://www.pminyc.org/calendar?eventId=42",
  );
  assert.equal(
    sourceRetrievalUrl(
      "https://www.productcircle.co/events/new-york-november-2026?token=PRIVATE&utm_source=x#fragment",
      productCircle,
    ),
    "https://www.productcircle.co/events/new-york-november-2026",
  );
  for (const input of [
    "http://finos.org/hosted-events/audit-example",
    "https://user:secret@finos.org/hosted-events/audit-example",
    finosUrl + " ",
    "https://finos.org:8443/hosted-events/audit-example",
    "https://evil.test/audit-example",
    finosUrl + "/other",
  ]) {
    assert.throws(() => sourceRetrievalUrl(input, finos), {
      code: "source_capture_blocked_url",
    });
  }
  const querySource = sourceIdentity(url + "?token=PRIVATE");
  assert.throws(() => sourceRetrievalUrl(querySource.source_url, querySource), {
    code: "source_capture_blocked_url",
  });
});

test("Product Circle redirects preserve one dated identity and reject another edition", async () => {
  const captured = await captureSourcePage(
    productCircle,
    productCircleUrl,
    signal,
    {
      now,
      resolve: dns,
      request: async (target) =>
        target.hostname === "productcircle.co"
          ? response("", 301, {
              location:
                "https://www.productcircle.co/events/new-york-november-2026?token=PRIVATE",
            })
          : response(report),
    },
  );
  assert.equal(
    captured.final_url,
    "https://www.productcircle.co/events/new-york-november-2026",
  );
  assert.equal(captured.redirects, 1);
  assert.deepEqual(validateCapturedPages([captured], [productCircle]), [
    captured,
  ]);
  await assert.rejects(
    captureSourcePage(productCircle, productCircleUrl, signal, {
      resolve: dns,
      request: async () =>
        response("", 301, {
          location: "https://productcircle.co/events/boston-november-2026",
        }),
    }),
    { code: "source_capture_blocked_url" },
  );
});

test("only public addresses can reach a pinned transport, including mixed DNS answers", async () => {
  for (const ip of [
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "198.18.0.1",
    "192.0.2.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "not-an-ip",
  ])
    assert.equal(isPublicCaptureAddress(ip), false, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])
    assert.equal(isPublicCaptureAddress(ip), true, ip);
  let calls = 0;
  await assert.rejects(
    captureSourcePage(source, url, signal, {
      resolve: async () => [
        ...(await dns()),
        { address: "127.0.0.1", family: 4 },
      ],
      request: async () => {
        calls += 1;
        return response();
      },
    }),
    { code: "source_capture_blocked_address" },
  );
  assert.equal(calls, 0);
});

test("same-identity redirects preserve WWW and never forward auth, cookies or private query parameters", async (t) => {
  const requests = [];
  t.mock.method(https, "request", (targetUrl, opts, callback) => {
    requests.push({ url: targetUrl.toString(), opts });
    const output = new EventEmitter();
    output.end = () => {
      const incoming = Readable.from(
        requests.length === 1 ? [] : [Buffer.from(report)],
      );
      incoming.statusCode = requests.length === 1 ? 301 : 200;
      incoming.headers =
        requests.length === 1
          ? {
              location:
                "https://www.finos.org/hosted-events/audit-example?token=PRIVATE",
              "set-cookie": "PRIVATE",
            }
          : {
              "content-type": "text/html",
              "content-length": String(Buffer.byteLength(report)),
            };
      incoming.complete = true;
      callback(incoming);
    };
    return output;
  });
  const captured = await captureSourcePage(finos, finosUrl, signal, {
    resolve: dns,
    now,
  });
  assert.equal(
    captured.final_url,
    "https://www.finos.org/hosted-events/audit-example",
  );
  assert.equal(captured.redirects, 1);
  assert.equal(requests.length, 2);
  for (const { url: requestUrl, opts } of requests) {
    assert.ok(!requestUrl.includes("PRIVATE"));
    assert.equal(opts.agent, false);
    assert.equal(opts.rejectUnauthorized, true);
    assert.equal(opts.family, 4);
    assert.equal(opts.headers.Cookie, undefined);
    assert.equal(opts.headers.Authorization, undefined);
    opts.lookup("ignored", {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, "93.184.216.34");
      assert.equal(family, 4);
    });
  }
});

test("unsafe redirects, changed event IDs, loops and redirect budgets fail without retries", async () => {
  for (const destination of [
    "https://127.0.0.1/",
    "http://luma.com/founder-test",
    "https://luma.com/another-event",
    "https://evil.test/",
    "https://user:PRIVATE@luma.com/founder-test",
  ]) {
    let calls = 0;
    await assert.rejects(
      captureSourcePage(source, url, signal, {
        resolve: dns,
        request: async () => {
          calls += 1;
          return response("", 302, { location: destination });
        },
      }),
      { code: "source_capture_blocked_url" },
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(
    captureSourcePage(source, url, signal, {
      resolve: dns,
      request: async () => {
        calls += 1;
        return response("", 302, { location: url });
      },
    }),
    { code: "source_capture_redirect_limit" },
  );
  assert.equal(calls, 1);
});

test("Meetup slash and WWW redirects preserve identity, strip private parameters and validate snapshots", async () => {
  const listing = "https://meetup.com/synthetic-group/events/123456789";
  const identity = sourceIdentity(listing);
  for (const www of [false, true]) {
    const requests = [];
    let lookups = 0;
    const captured = await captureSourcePage(identity, listing, signal, {
      now,
      resolve: async () => {
        lookups += 1;
        return dns();
      },
      request: async (target) => {
        requests.push(target.toString());
        if (requests.length === 1)
          return response("", 308, {
            location: target.pathname + "/?utm_source=PRIVATE#private",
          });
        if (www && requests.length === 2)
          return response("", 301, {
            location:
              listing.replace("https://", "https://www.") +
              "/?utm_source=PRIVATE",
          });
        return response(report);
      },
    });
    assert.deepEqual(requests, [
      listing,
      listing + "/",
      ...(www ? [listing.replace("https://", "https://www.") + "/"] : []),
    ]);
    assert.equal(lookups, requests.length);
    assert.equal(captured.source_url, listing);
    assert.equal(captured.redirects, www ? 2 : 1);
    assert.deepEqual(validateCapturedPages([captured], [identity]), [captured]);
  }
  assert.throws(() => sourceRetrievalUrl(listing + "//", identity), {
    code: "source_capture_blocked_url",
  });
  assert.throws(
    () => sourceRetrievalUrl(listing + "/?token=PRIVATE", identity),
    { code: "source_capture_blocked_url" },
  );
});

test("slash oscillations and a third redirect still fail at unchanged capture bounds", async () => {
  for (const destinations of [
    [url + "/", url],
    [
      url + "/",
      url.replace("https://", "https://www.") + "/",
      url.replace("https://", "https://www."),
    ],
  ]) {
    let calls = 0;
    await assert.rejects(
      captureSourcePage(source, url, signal, {
        resolve: dns,
        request: async () =>
          response("", 308, { location: destinations[calls++] }),
      }),
      { code: "source_capture_redirect_limit" },
    );
    assert.equal(calls, destinations.length);
    assert.equal(SOURCE_CAPTURE_LIMITS.redirects, 2);
  }
});

test("malformed captured-page extraction retains its evidence-path diagnostic without repair", async () => {
  const malformed = new OpenRouterSearchProvider(
    "fake-key",
    "vendor/offline",
    "medium",
    async () => router("{malformed"),
  );
  await assert.rejects(
    malformed.extract(
      { report, urls: [url], metadata: {}, source_pages: [page()] },
      [source],
      options,
      signal,
    ),
    {
      code: "invalid_extraction_json",
    },
  );
  assert.equal(
    malformed.getDiagnostics()[0].fetch_verification,
    "local_source_capture",
  );
});

test("bounded native readers reject excessive, incomplete and mismatched response bodies", async (t) => {
  for (const [headers, complete, body, code] of [
    [{ "content-length": "1048577" }, true, report, "source_capture_too_large"],
    [{}, true, "x".repeat(1048577), "source_capture_too_large"],
    [{ "content-length": "999" }, true, report, "source_capture_incomplete"],
    [{}, false, report, "source_capture_incomplete"],
  ]) {
    const stub = t.mock.method(https, "request", (_url, _opts, callback) => {
      const outgoing = new EventEmitter();
      outgoing.end = () => {
        const incoming = Readable.from([Buffer.from(body)]);
        incoming.statusCode = 200;
        incoming.complete = complete;
        incoming.headers = { "content-type": "text/html", ...headers };
        callback(incoming);
      };
      return outgoing;
    });
    await assert.rejects(
      captureSourcePage(source, url, signal, { resolve: dns }),
      { code },
    );
    stub.mock.restore();
  }
});

test("HTTP, content, charset, challenge and transport failures retain fixed codes only", async () => {
  for (const [reply, code] of [
    [response("PRIVATE raw server error", 403), "source_capture_http_error"],
    [
      response(report, 200, { "content-type": "application/pdf" }),
      "source_capture_unsupported_content",
    ],
    [
      response(report, 200, { "content-encoding": "gzip" }),
      "source_capture_unsupported_content",
    ],
    [
      response(report, 200, {
        "content-type": 'text/html; charset="iso-8859-1"',
      }),
      "source_capture_invalid_encoding",
    ],
    [
      response("Verify you are human to continue. " + "PRIVATE".repeat(10)),
      "source_capture_challenge",
    ],
    [response("short"), "source_capture_empty"],
    [response("x".repeat(16001)), "source_capture_too_large"],
    [
      { ...response(), body: new Uint8Array([0xff, 0xfe, 0xfd]) },
      "source_capture_invalid_encoding",
    ],
  ]) {
    let calls = 0;
    await assert.rejects(
      captureSourcePage(source, url, signal, {
        resolve: dns,
        request: async () => {
          calls += 1;
          return reply;
        },
      }),
      (error) => {
        assert.equal(error.code, code);
        assert.ok(
          !JSON.stringify(captureFailureDetails(error)).includes("PRIVATE"),
        );
        assert.ok(!error.message.includes("PRIVATE"));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    captureSourcePage(source, url, signal, {
      resolve: dns,
      request: async () => {
        throw new Error("PRIVATE transport detail");
      },
    }),
    { code: "source_capture_fetch_failed" },
  );
});

test("capture cancellation and timeout stop without fallback or orphaned paid work", async (t) => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    captureSourcePage(source, url, controller.signal, {
      resolve: async () => {
        calls += 1;
        return dns();
      },
    }),
    { code: "run_cancelled" },
  );
  assert.equal(calls, 0);
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", () => originalTimeout(5));
  const keepAlive = setTimeout(() => {}, 30);
  try {
    await assert.rejects(
      captureSourcePage(source, url, signal, {
        resolve: () => new Promise(() => {}),
      }),
      { code: "source_capture_timeout" },
    );
  } finally {
    clearTimeout(keepAlive);
  }
});

test("static extraction preserves Event JSON-LD and removes executable/framework state without inventing data", () => {
  const html = `<html><h1>Sample &amp; Example</h1><p>NYC gathering with explicit source evidence &#8212; &constructor;.</p><script>PRIVATE_EXECUTABLE()</script><script type="application/json">{"credential":"PRIVATE_STATE"}</script><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Event", name: "Sample Example", startDate: "2026-09-05T18:00:00-04:00", private_token: "PRIVATE_TOKEN" }] })}</script></html>`;
  const text = extractSourceText(html, "text/html");
  assert.ok(text.includes("Sample & Example"));
  assert.ok(text.includes("2026-09-05T18:00:00-04:00"));
  assert.ok(text.includes("&constructor;"));
  assert.doesNotMatch(text, /PRIVATE_EXECUTABLE|PRIVATE_STATE|PRIVATE_TOKEN/);
  const nested = extractSourceText(
    JSON.stringify({
      "@type": "Event",
      name: "Sample Example",
      location: {
        "@type": "Place",
        name: "Venue",
        private_token: "PRIVATE_NESTED",
        address: { addressLocality: "New York", credential: "PRIVATE_ADDRESS" },
      },
    }),
    "application/ld+json",
  );
  assert.match(nested, /New York/);
  assert.doesNotMatch(nested, /PRIVATE_NESTED|PRIVATE_ADDRESS/);
  assert.throws(
    () => extractSourceText(report + "<script>PRIVATE_UNCLOSED", "text/html"),
    {
      code: "source_capture_incomplete",
    },
  );
  assert.throws(
    () =>
      extractSourceText(
        '<script type="application/ld+json">{broken</script>',
        "text/html",
      ),
    { code: "source_capture_incomplete" },
  );
  assert.throws(() => extractSourceText("{broken}", "application/json"), {
    code: "source_capture_incomplete",
  });
  assert.throws(
    () =>
      extractSourceText(
        "<title>Log in</title><p>" + report + "</p>",
        "text/html",
      ),
    { code: "source_capture_challenge" },
  );
});

test("private snapshots validate hashes, source identity, source count and aggregate size before paid extraction", async () => {
  assert.equal(validateCapturedPages([page()], [source]).length, 1);
  for (const pages of [
    [],
    [page(), page()],
    [{ ...page(), text: report + "invented" }],
    [{ ...page(), final_url: "https://evil.test/" }],
    [{ ...page(), source_url: "https://luma.com/other" }],
    [{ ...page(), credential: "PRIVATE" }],
  ]) {
    let calls = 0;
    const provider = new OpenRouterSearchProvider(
      "fake-key",
      "vendor/offline",
      "medium",
      async () => {
        calls += 1;
        return router("{}");
      },
    );
    await assert.rejects(
      provider.extract(
        { report, urls: [url], metadata: {}, source_pages: pages },
        [source],
        options,
        signal,
      ),
    );
    assert.equal(calls, 0);
  }
  const pages = Array.from({ length: 6 }, (_, i) =>
    page("x".repeat(15000), "https://luma.com/budget-" + i),
  );
  assert.throws(
    () =>
      validateCapturedPages(
        pages,
        pages.map((p) => sourceIdentity(p.source_url)),
      ),
    { code: "invalid_source_evidence" },
  );
});

test("captured extraction uses strict tool-free requests and forbids unexpected provider tools before repair", async () => {
  const requests = [];
  const provider = new OpenRouterSearchProvider(
    "fake-key",
    "vendor/offline",
    "medium",
    async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return router(JSON.stringify({ candidates: [candidate()] }));
    },
  );
  const result = await provider.extract(
    {
      report: "Sparse discovery",
      urls: [url],
      metadata: {},
      source_pages: [page()],
    },
    [source],
    options,
    signal,
  );
  assert.equal(result.candidates.length, 1);
  const request = requests[0];
  assert.equal(request.tools, undefined);
  assert.equal(request.tool_choice, undefined);
  assert.equal(request.max_tool_calls, undefined);
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.provider.require_parameters, true);
  assert.deepEqual(request.reasoning, { effort: "medium", exclude: true });
  const input = JSON.parse(request.messages[1].content);
  assert.equal(input.untrusted_source_pages[0].captured_text, report);
  assert.equal(
    provider.getDiagnostics()[0].fetch_verification,
    "local_source_capture",
  );
  let calls = 0;
  const unsafe = new OpenRouterSearchProvider(
    "fake-key",
    "vendor/offline",
    "medium",
    async () => {
      calls += 1;
      return router(JSON.stringify({ unfamiliar: candidate() }), {
        web_fetch_requests: 1,
      });
    },
  );
  await assert.rejects(
    unsafe.extract(
      { report, urls: [url], metadata: {}, source_pages: [page()] },
      [source],
      options,
      signal,
    ),
    { code: "unexpected_extraction_tools" },
  );
  assert.equal(calls, 1);
});

test("career drafts ground missing discovery facts in captured text while keeping unknowns and source isolation", async () => {
  const text = report + " Product discovery discussion. PRIVATE_SOURCE_COPY";
  const c = careerCandidate(text);
  const repo = memoryRepository();
  const seen = [];
  const provider = {
    async research() {
      return {
        report: "Sparse discovery report",
        urls: [url],
        metadata: {},
        retrieval_urls: { [url]: "https://www.luma.com/founder-test" },
      };
    },
    async extract(research) {
      seen.push(research);
      return { candidates: [c], metadata: {} };
    },
  };
  const summary = await runIngestion(careerOptions, {
    provider,
    repository: repo,
    signal,
    now,
    captureSource: async (selected, retrieval) => {
      assert.equal(selected.source_url, url);
      assert.equal(retrieval, "https://www.luma.com/founder-test");
      return page(text);
    },
  });
  assert.equal(summary.status, "succeeded");
  assert.equal(summary.events_written, 1);
  assert.equal(seen[0].source_pages[0].text, text);
  const event = [...repo.events.values()][0];
  assert.equal(event.price_amount_cents, null);
  assert.ok(event.career_assessment.score > 0);
  assert.equal(
    repo.sources.get(url).raw_payload.evidence_kind,
    "source_page_text_v1",
  );
  assert.equal(
    repo.runs[0].metadata.research_report,
    "Sparse discovery report",
  );
  assert.ok(!JSON.stringify(summary).includes("PRIVATE_SOURCE_COPY"));
  assert.throws(
    () =>
      normalizeCandidate(
        c,
        source,
        "another source's evidence",
        careerOptions,
        now().toISOString(),
      ),
    { code: "invalid_event_timezone" },
  );
});

test("capture failures preserve old successful evidence and skip extraction when every source fails", async () => {
  const repo = memoryRepository();
  let extractions = 0;
  const provider = {
    async research() {
      return { report: "Sparse discovery", urls: [url], metadata: {} };
    },
    async extract() {
      extractions += 1;
      return { candidates: [candidate()], metadata: {} };
    },
  };
  const success = await runIngestion(options, {
    provider,
    repository: repo,
    signal,
    now,
    captureSource: async () => page(),
  });
  assert.equal(success.events_written, 1);
  const evidence = repo.sources.get(url).content_text;
  const refreshed = await runIngestion(options, {
    provider,
    repository: repo,
    signal,
    now,
    captureSource: async () =>
      captureSourcePage(source, url, signal, {
        resolve: dns,
        request: async () => response("blocked", 403),
      }),
  });
  assert.equal(refreshed.status, "partial");
  assert.equal(refreshed.events_written, 0);
  assert.equal(refreshed.sources_unlinked, 0);
  assert.equal(extractions, 1);
  assert.equal(repo.sources.get(url).content_text, evidence);
  assert.equal(
    repo.sources.get(url).last_attempt_error,
    "source_capture_http_error",
  );
  assert.equal(refreshed.source_capture_diagnostics[0].http_status, 403);
});

test("a failed captured sibling stays unlinked while a successful sibling proceeds once", async () => {
  const second = "https://luma.com/second-page";
  const repo = memoryRepository();
  const provider = {
    async research() {
      return { report: "Sparse discovery", urls: [url, second], metadata: {} };
    },
    async extract(research, sources) {
      assert.equal(sources.length, 1);
      assert.equal(research.source_pages.length, 1);
      return { candidates: [candidate()], metadata: {} };
    },
  };
  const summary = await runIngestion(options, {
    provider,
    repository: repo,
    signal,
    now,
    captureSource: async (selected) => {
      if (selected.source_url === second)
        throw new Error("PRIVATE raw network failure");
      return page();
    },
  });
  assert.equal(summary.events_written, 1);
  assert.equal(summary.sources_unlinked, 1);
  assert.deepEqual(summary.errors, ["source_capture_fetch_failed"]);
  assert.ok(!JSON.stringify(summary).includes("PRIVATE"));
});

test("SQLite stores private capture evidence, inspection stays safe, and review/publication boundaries still hold", async () => {
  await mkdir("codex-tmp", { recursive: true });
  const dir = await mkdtemp("codex-tmp/source-capture-test-");
  const path = dir + "/test.sqlite";
  const repo = new SqliteIngestionRepository(
    path,
    "vendor/offline",
    "medium",
    "vendor/offline",
    "medium",
  );
  const text = report + " PRIVATE_CAPTURE_ONLY";
  const provider = {
    async research() {
      return { report: "Sparse discovery", urls: [url], metadata: {} };
    },
    async extract() {
      return { candidates: [candidate()], metadata: {} };
    },
  };
  const result = await runIngestion(options, {
    provider,
    repository: repo,
    signal,
    now,
    captureSource: async () => page(text),
  });
  assert.equal(result.events_written, 1);
  const inspection = await runInspectionCli(["--run", result.run_id], (id) =>
    executeSqliteInspection(id, path),
  );
  assert.equal(inspection.source_capture_diagnostics[0].status, "captured");
  assert.ok(!JSON.stringify(inspection).includes("PRIVATE_CAPTURE_ONLY"));
  const db = openSqliteDatabase(path);
  const stored = db.prepare("select * from event_sources").get();
  assert.equal(JSON.parse(stored.raw_payload).source_page.text, text);
  db.close();
  const review = executeSqliteReview(
    { command: "preview", eventId: stored.event_id, sourceId: stored.id },
    path,
  );
  const reviewed = buildReviewReport(review, now());
  assert.equal(reviewed.blockers.length, 0);
  assert.ok(
    !JSON.stringify(reviewed.publicPreview).includes("PRIVATE_CAPTURE_ONLY"),
  );
  assert.equal(
    (await loadDashboard({ env: { SQLITE_DATABASE_PATH: path }, now: now() }))
      .status,
    "empty",
  );
  await runIngestion(options, {
    provider,
    repository: repo,
    signal,
    now,
    captureSource: async () => page(text + " Updated page."),
  });
  assert.throws(
    () =>
      executeSqliteReview(
        {
          command: "publish",
          eventId: stored.event_id,
          sourceId: stored.id,
          token: review.review_token,
          approved: true,
        },
        path,
      ),
    /changed|stale/i,
  );
});

test("capture inspection allowlists fixed metadata and rejects reflected text, invalid counts and oversized arrays", () => {
  const good = {
    source_id: "90000000-0000-4000-8000-000000000030",
    status: "captured",
    error_code: null,
    http_status: 200,
    content_type: "text/html",
    response_bytes: 42,
    redirects: 0,
  };
  assert.equal(safeCaptureDiagnostics([good]).length, 1);
  assert.equal(
    safeCaptureDiagnostics([
      { ...good, text: "PRIVATE" },
      { ...good, http_status: 999 },
      { ...good, response_bytes: -1 },
      { ...good, error_code: "PRIVATE" },
    ]).length,
    0,
  );
  assert.equal(
    safeCaptureDiagnostics(Array(20).fill(good)).length,
    SOURCE_CAPTURE_LIMITS.sources,
  );
});

test("captured evidence survives extraction failure and cancellation closes the run without a fallback", async () => {
  const repo = memoryRepository();
  const provider = {
    async research() {
      return { report: "Sparse discovery", urls: [url], metadata: {} };
    },
    async extract() {
      throw new Error("PRIVATE provider error");
    },
  };
  const failed = await runIngestion(options, {
    provider,
    repository: repo,
    signal,
    now,
    captureSource: async () => page(),
  });
  assert.equal(failed.events_written, 0);
  assert.equal(repo.runs[0].metadata.source_pages[0].text, report);
  assert.equal(repo.runs[0].summary.status, "partial");
  assert.ok(!JSON.stringify(failed).includes("PRIVATE"));
  const controller = new AbortController();
  let extractionCalls = 0;
  provider.extract = async () => {
    extractionCalls += 1;
    return { candidates: [], metadata: {} };
  };
  const cancelled = await runIngestion(options, {
    provider,
    repository: repo,
    signal: controller.signal,
    now,
    captureSource: async () => {
      controller.abort();
      throw new Error("PRIVATE cancellation");
    },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(repo.runs[1].summary.status, "cancelled");
  assert.equal(extractionCalls, 0);
});

test("captured extraction keeps one bounded fact-preserving repair and both calls tool-free", async () => {
  const bodies = [];
  const provider = new OpenRouterSearchProvider(
    "fake-key",
    "vendor/offline",
    "medium",
    async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return router(
        JSON.stringify(
          bodies.length === 1
            ? [{ ...candidate(), unfamiliar: null }]
            : { candidates: [candidate()] },
        ),
      );
    },
    "vendor/offline",
    "medium",
  );
  const result = await provider.extract(
    {
      report: "Sparse discovery",
      urls: [url],
      metadata: {},
      source_pages: [page()],
    },
    [source],
    options,
    signal,
  );
  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    assert.equal(body.tools, undefined);
    assert.equal(body.tool_choice, undefined);
    assert.equal(body.provider.require_parameters, true);
  }
  assert.equal(result.candidates.length, 1);
  assert.equal(provider.getDiagnostics()[1].repair_validation, "accepted");
  assert.equal(
    normalizeCandidate(
      result.candidates[0],
      source,
      report,
      options,
      now().toISOString(),
    ).title,
    "Founder Test",
  );
});

test("captured candidates that start during extraction are rejected at the refreshed observation time", async () => {
  let current = now();
  const result = await runIngestion(options, {
    repository: memoryRepository(),
    signal,
    now: () => current,
    captureSource: async () => page(),
    provider: {
      async research() {
        return { report: "Sparse discovery", urls: [url], metadata: {} };
      },
      async extract() {
        current = new Date("2026-09-05T22:01:00Z");
        return { candidates: [candidate()], metadata: {} };
      },
    },
  });
  assert.equal(result.events_written, 0);
  assert.ok(result.errors.includes("event_already_started"));
});

test("Supabase SDK checkpoints and atomic RPC retain private snapshots without changing storage semantics", async () => {
  const calls = [];
  const runId = "90000000-0000-4000-8000-000000000041";
  const sourceId = "90000000-0000-4000-8000-000000000042";
  let saves = 0;
  const client = createClient(
    "http://127.0.0.1:54321",
    "offline-test-not-a-key",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const requestUrl = String(input);
          const body = init.body ? JSON.parse(init.body) : null;
          calls.push({ url: requestUrl, body });
          let value = { id: runId };
          if (
            requestUrl.includes("last_attempt_error=eq.source_page_cancelled")
          )
            value = [];
          else if (requestUrl.includes("/rpc/")) {
            saves += 1;
            value = {
              source_id: sourceId,
              event_id: body.p_event
                ? "90000000-0000-4000-8000-000000000043"
                : null,
              source_created: saves === 1,
              event_written: Boolean(body.p_event),
            };
          }
          return new Response(JSON.stringify(value), {
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
  );
  const repository = new SupabaseIngestionRepository(
    client,
    "vendor/offline",
    "medium",
    "vendor/offline",
    "medium",
  );
  const result = await runIngestion(options, {
    repository,
    signal,
    now,
    captureSource: async () => page(),
    provider: {
      async research() {
        return { report: "Sparse discovery", urls: [url], metadata: {} };
      },
      async extract() {
        return { candidates: [candidate()], metadata: {} };
      },
    },
  });
  assert.equal(result.events_written, 1);
  const saved = calls.find(({ body }) => body?.p_event);
  assert.equal(saved.body.p_source.content_text, report);
  assert.equal(saved.body.p_source.raw_payload.source_page.text, report);
  const finished = calls.at(-1).body;
  assert.equal(finished.metadata.source_pages[0].text, report);
  assert.equal(
    finished.metadata.summary.source_capture_diagnostics[0].source_id,
    sourceId,
  );
  assert.equal(finished.status, "succeeded");
});
