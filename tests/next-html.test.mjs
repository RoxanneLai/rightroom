import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { assertDashboardHtml } from "./assert-dashboard.mjs";

test("the standard Next.js build preserves the separate fictional sample edition", async () => {
  const html = await readFile(
    new URL("../.next/server/app/sample.html", import.meta.url),
    "utf8",
  );
  assertDashboardHtml(html);
});

test("the published feed is dynamic while the sample edition is prerendered", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../.next/prerender-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.routes["/"], undefined);
  assert.ok(manifest.routes["/sample"]);
  assert.equal(manifest.routes["/career"], undefined);
  assert.equal(manifest.routes["/events"], undefined);
  assert.ok(manifest.routes["/sample/career"]);
});

test("career sample is clearly fictional and explains scores, unknowns and cautions", async () => {
  const html = await readFile(
    new URL("../.next/server/app/sample/career.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /fictional career shortlist/i);
  assert.match(html, /Role fit/);
  assert.match(html, /Hiring/);
  assert.match(html, /ranking hypothesis/);
  const cards = html.match(/<article\b[\s\S]*?<\/article>/g) ?? [];
  for (const card of cards) {
    assert.match(card, /Attendance &amp; eligibility/);
    assert.match(
      card,
      /Career fit and open registration do not confirm attendance eligibility/,
    );
    assert.ok(
      card.indexOf("career-attendance") < card.indexOf("Why this room fits"),
    );
  }
  assert.match(html, /Attendance requires approval/);
  assert.match(html, /Technical prerequisites apply; check the listing/);
  assert.equal((html.match(/<article\b/g) ?? []).length, 3);
  assert.match(
    html,
    /<strong>03<\/strong>\s*<span>with career-fit scores<\/span>/,
  );
  assert.doesNotMatch(html, /raw_payload|source_verification|research_report/);
  assert.match(
    html,
    /<a\b(?=[^>]*href="\/")(?=[^>]*class="edition-link")[^>]*>/,
  );
});
