import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { publicListingUrl } from "../../lib/public-listing-url.ts";
import { sourceIdentity } from "../../lib/ingestion/sources.ts";

// Always create an isolated database, never reset or alter the user's postgres DB.
const container = "supabase_db_founder-radar";
const database =
  "fr_review_test_" + randomUUID().replaceAll("-", "").slice(0, 16);
let created = false;

function docker(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(new Error(errors || "Docker database command failed"));
      else resolve(output);
    });
    child.stdin.end(input);
  });
}

function sql(input) {
  return docker(
    [
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      database,
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "-",
    ],
    input,
  );
}

before(async () => {
  await docker(["createdb", "-U", "postgres", database]);
  created = true;
  await sql(
    "create schema extensions; grant usage on schema extensions to public;",
  );
  const migrations = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrations)
    await sql(await readFile("supabase/migrations/" + name, "utf8"));
  await sql(await readFile("supabase/seed.sql", "utf8"));
});

after(async () => {
  assert.match(database, /^fr_review_test_[a-f0-9]{16}$/);
  if (created) await docker(["dropdb", "-U", "postgres", database]);
});

test("all pgTAP contracts pass against migrations and seeds in a disposable database", async (t) => {
  const tests = (await readdir("supabase/tests/database"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of tests) {
    const output = await sql(
      await readFile("supabase/tests/database/" + name, "utf8"),
    );
    assert.doesNotMatch(
      output,
      /not ok|Looks like you failed|Bad plan/i,
      name + "\n" + output,
    );
    assert.match(output, /\b1\.\.\d+/, name + " did not run pgTAP");
    t.diagnostic(
      name + ": " + output.match(/\b1\.\.(\d+)/)[1] + " assertions passed",
    );
  }
});

test("AICamp URL validation has actual PostgreSQL, ingestion and public-link parity", async () => {
  const base = "https://aicamp.ai/event/eventdetails/";
  const canonical = base + "W2099010101";
  const cases = [
    [canonical, canonical],
    [canonical + "/?token=PRIVATE&utm_source=test#fragment", canonical],
    [canonical.replace("https://", "https://www."), canonical],
    [base + "W2099010102", base + "W2099010102"],
    ...[
      base,
      base + "calendar",
      base + "login",
      base + "w2099010101",
      base + "X2099010101",
      base + "W209901010",
      base + "W20990101012",
      base + "%572099010101",
      canonical + "/extra",
      canonical + "-extra",
      "https://aicamp.ai/event/other/W2099010101",
      "https://aicamp.ai/community",
      canonical.replace("aicamp.ai", "events.aicamp.ai"),
      canonical.replace("aicamp.ai", "aicamp.ai.evil.test"),
      canonical.replace("https:", "http:"),
      canonical.replace("https://", "https://user:PRIVATE@"),
      canonical.replace("aicamp.ai", "aicamp.ai:8443"),
    ].map((url) => [url, null]),
  ];
  for (const [url, expected] of cases) {
    assert.equal(publicListingUrl(url), expected, url);
    assert.equal(sourceIdentity(url)?.source_url ?? null, expected, url);
    const actual = await sql(
      "select coalesce(public.public_listing_url('" +
        url.replaceAll("'", "''") +
        "'), '<NULL>');",
    );
    assert.equal(actual.trim(), expected ?? "<NULL>", url);
  }
});

test("Product Circle validation has PostgreSQL, ingestion and public-link parity", async () => {
  const base = "https://productcircle.co/events/";
  const canonical = base + "new-york-november-2026";
  const cases = [
    [canonical, canonical],
    [canonical + "/?token=PRIVATE&utm_source=test#fragment", canonical],
    [canonical.replace("https://", "https://www."), canonical],
    [base + "boston-november-2026", base + "boston-november-2026"],
    ...[
      "https://productcircle.co/events",
      base,
      base + "nyc",
      base + "new-york-2026",
      base + "new-york-summer-2026",
      base + "New-York-November-2026",
      base + "new-york-november-26",
      base + "new-york-november-2026/extra",
      base + "new-york-november-2026-extra",
      "https://productcircle.co/community",
      canonical.replace("productcircle.co", "events.productcircle.co"),
      canonical.replace("productcircle.co", "productcircle.co.evil.test"),
      canonical.replace("https:", "http:"),
      canonical.replace("https://", "https://user:PRIVATE@"),
      canonical.replace("productcircle.co", "productcircle.co:8443"),
    ].map((url) => [url, null]),
  ];
  for (const [url, expected] of cases) {
    assert.equal(publicListingUrl(url), expected, url);
    assert.equal(sourceIdentity(url)?.source_url ?? null, expected, url);
    const actual = await sql(
      "select coalesce(public.public_listing_url('" +
        url.replaceAll("'", "''") +
        "'), '<NULL>');",
    );
    assert.equal(actual.trim(), expected ?? "<NULL>", url);
  }
});

test("concurrent repeat ingestion writes one source and one linked draft", async () => {
  const runId = randomUUID();
  await sql(
    "insert into public.search_runs(id,agent_name,provider) values ('" +
      runId +
      "','concurrency-test','test');",
  );
  const source = {
    source_name: "concurrency-test",
    source_url: "https://example.invalid/concurrent",
    content_text: "test evidence",
  };
  const event = {
    title: "Concurrency test",
    starts_at: "2026-09-05T22:00:00Z",
    time_zone: "America/New_York",
    city: "New York",
    region: "NY",
    country_code: "US",
    event_format: "in-person",
  };
  const statement =
    "select * from public.ingest_event_source('" +
    runId +
    "', '" +
    JSON.stringify(source) +
    "'::jsonb, '" +
    JSON.stringify(event) +
    "'::jsonb);";
  await Promise.all([sql(statement), sql(statement)]);
  const counts = await sql(
    "select count(*), count(distinct event_id) from public.event_sources where source_name='concurrency-test';",
  );
  assert.equal(counts.trim(), "1|1");
  assert.equal(
    (
      await sql(
        "select count(*) from public.events where title='Concurrency test';",
      )
    ).trim(),
    "1",
  );
});

function reviewCli(args, succeeds = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--conditions=react-server",
        "--experimental-strip-types",
        "scripts/review.ts",
        ...args,
        "--database",
        database,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, DATABASE_BACKEND: "supabase" },
      },
    );
    let output = "";
    let errors = "";
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (succeeds && code === 0) {
        try {
          resolve(JSON.parse(output));
        } catch (error) {
          reject(error);
        }
      } else if (!succeeds && code !== 0) resolve({ errors, output });
      else reject(new Error("Unexpected local review exit: " + errors));
    });
  });
}

async function createReviewDraft() {
  const eventId = randomUUID();
  const sourceId = randomUUID();
  await sql(`insert into public.events(id,title,starts_at) values ('${eventId}', 'Synthetic operator review', now() + interval '1 day');
    insert into public.event_sources(id,event_id,source_name,source_url,content_text,fetched_at)
    values ('${sourceId}', '${eventId}', 'luma.com', 'https://luma.com/synthetic-${sourceId}?private=secret', 'PRIVATE CLI SYNTHETIC EVIDENCE', now());`);
  return { eventId, sourceId };
}

test("real local CLI lists, inspects, previews and explicitly publishes only a disposable draft", async () => {
  const { eventId, sourceId } = await createReviewDraft();
  const list = await reviewCli(["list"]);
  assert.ok(list.drafts.some((event) => event.id === eventId));
  const inspect = await reviewCli(["inspect", "--event", eventId]);
  assert.equal(inspect.approval, null);
  assert.equal(inspect.sources[0].id, sourceId);
  assert.equal(
    inspect.sources[0].content_text,
    "PRIVATE CLI SYNTHETIC EVIDENCE",
  );
  const previewArgs = ["preview", "--event", eventId, "--source", sourceId];
  const preview = await reviewCli(previewArgs);
  assert.deepEqual(preview.blockers, []);
  assert.equal(
    preview.publicPreview.card.registrationUrl,
    `https://luma.com/synthetic-${sourceId}`,
  );
  assert.doesNotMatch(JSON.stringify(preview.publicPreview), /PRIVATE|secret/);
  assert.equal(
    (
      await sql(
        `select publication_status from public.events where id='${eventId}'`,
      )
    ).trim(),
    "draft",
  );
  const publishArgs = [
    "publish",
    "--event",
    eventId,
    "--source",
    sourceId,
    "--token",
    preview.approval.token,
    "--approve",
  ];
  await sql(
    `update public.events set organizer_name='Changed after preview' where id='${eventId}'`,
  );
  const stale = await reviewCli(publishArgs, false);
  assert.match(stale.errors, /changed/);
  assert.doesNotMatch(stale.errors, /PRIVATE|secret|CONTEXT|SQL statement/);
  const refreshed = await reviewCli(previewArgs);
  publishArgs[publishArgs.indexOf("--token") + 1] = refreshed.approval.token;
  const published = await reviewCli(publishArgs);
  assert.equal(published.publication_status, "published");
  const visible = JSON.parse(
    (
      await sql(
        `set role anon; select row_to_json(e) from public.events e where id='${eventId}';`,
      )
    )
      .trim()
      .replace(/^SET\s*/, ""),
  );
  assert.equal(
    visible.public_registration_url,
    preview.publicPreview.card.registrationUrl,
  );
  assert.equal(visible.organizer_name, refreshed.publicPreview.card.organizer);
  const repeated = await reviewCli(publishArgs, false);
  assert.match(repeated.errors, /changed|draft/);
  assert.equal(
    (
      await sql(
        `select count(*) from public.event_publication_reviews where event_id='${eventId}'`,
      )
    ).trim(),
    "1",
  );
});

test("concurrent approvals publish once with one audit snapshot", async () => {
  const { eventId, sourceId } = await createReviewDraft();
  const review = JSON.parse(
    await sql(`select public.get_event_review('${eventId}', '${sourceId}')`),
  );
  const publish = `select public.publish_reviewed_event('${eventId}', '${sourceId}', '${review.review_token}', true);`;
  const outcomes = await Promise.allSettled([sql(publish), sql(publish)]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  assert.equal(
    (
      await sql(
        `select count(*) from public.event_publication_reviews where event_id='${eventId}'`,
      )
    ).trim(),
    "1",
  );
  assert.equal(
    (
      await sql(
        `select publication_status from public.events where id='${eventId}'`,
      )
    ).trim(),
    "published",
  );
});

test("ingestion after approval preserves the reviewed fields and public link", async () => {
  const { eventId, sourceId } = await createReviewDraft();
  const review = JSON.parse(
    await sql(`select public.get_event_review('${eventId}', '${sourceId}')`),
  );
  await sql(
    `select public.publish_reviewed_event('${eventId}', '${sourceId}', '${review.review_token}', true);`,
  );
  const runId = randomUUID();
  await sql(
    `insert into public.search_runs(id,agent_name,provider) values('${runId}','review-test','test');`,
  );
  const source = {
    source_name: "luma.com",
    source_url: `https://luma.com/synthetic-${sourceId}?private=secret`,
    content_text: "NEW PRIVATE RESEARCH",
  };
  const event = {
    title: "Do not overwrite approved title",
    starts_at: new Date(Date.now() + 172800000).toISOString(),
    time_zone: "America/New_York",
    city: "New York",
    region: "NY",
    country_code: "US",
    event_format: "in-person",
  };
  await sql(
    `select * from public.ingest_event_source('${runId}', '${JSON.stringify(source)}'::jsonb, '${JSON.stringify(event)}'::jsonb);`,
  );
  assert.equal(
    (await sql(`select title from public.events where id='${eventId}'`)).trim(),
    "Synthetic operator review",
  );
  assert.equal(
    (
      await sql(
        `select public_registration_url from public.events where id='${eventId}'`,
      )
    ).trim(),
    `https://luma.com/synthetic-${sourceId}`,
  );
  assert.equal(
    (
      await sql(
        `select review_snapshot->'sources'->0->>'content_text' from public.event_publication_reviews where event_id='${eventId}'`,
      )
    ).trim(),
    "PRIVATE CLI SYNTHETIC EVIDENCE",
  );
});
