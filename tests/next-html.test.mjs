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
  assert.match(html, /fictional technical-PM shortlist/i);
  assert.match(html, /Role fit/);
  assert.match(html, /Hiring/);
  assert.match(html, /ranking hypothesis/);
  const cards = html.match(/<article\b[\s\S]*?<\/article>/g) ?? [];
  for (const card of cards) {
    assert.match(card, /Attendance &amp; eligibility/);
    assert.match(
      card,
      /PM relevance and open registration do not confirm attendance eligibility/,
    );
    assert.ok(
      card.indexOf("career-attendance") <
        card.indexOf("Why it may fit this pilot"),
    );
    assert.match(
      card,
      /<details class="career-score-details"><summary>How the experimental score was calculated<\/summary>/,
    );
  }
  assert.match(html, /Attendance requires approval/);
  assert.match(html, /Technical prerequisites apply; check the listing/);
  assert.equal((html.match(/<article\b/g) ?? []).length, 3);
  assert.match(
    html,
    /<strong>03<\/strong>\s*<span>with PM-relevance scores<\/span>/,
  );
  assert.doesNotMatch(html, /raw_payload|source_verification|research_report/);
  assert.match(
    html,
    /<a\b(?=[^>]*href="\/")(?=[^>]*class="edition-link")[^>]*>/,
  );
});

test("personal choices render with safe hydration defaults while complete sample cards remain server-visible", async () => {
  const html = await readFile(
    new URL("../.next/server/app/sample/career.html", import.meta.url),
    "utf8",
  );
  const cards = html.match(/<article\b[\s\S]*?<\/article>/g) ?? [];
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.match(card, /My interest/);
    assert.match(card, /Not an RSVP/);
    assert.equal((card.match(/aria-pressed="false"/g) ?? []).length, 3);
    assert.equal((card.match(/<button\b[^>]*disabled/g) ?? []).length, 3);
  }
  const visibleHtml = html.replace(/<!--[\s\S]*?-->/g, "");
  assert.match(visibleHtml, /All events \(3\)/);
  assert.match(visibleHtml, /Original ranking retained/);
  assert.match(html, /Sample choices are separate from published events/);
  assert.match(html, /<noscript>[\s\S]*All events remain visible/);
  assert.match(html, /events available/);
});
