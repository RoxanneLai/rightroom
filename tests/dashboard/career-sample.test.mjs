import assert from "node:assert/strict";
import test from "node:test";
import { getCareerSampleEvents } from "../../lib/career/sample.ts";

test("career demo dates stay upcoming relative to the build without becoming live listings", () => {
  const reference = new Date("2026-10-28T12:00:00Z");
  const events = getCareerSampleEvents(reference);
  assert.deepEqual(
    events.map((event) => event.startsAt),
    [
      "2026-10-29T22:00:00.000Z",
      "2026-10-30T22:00:00.000Z",
      "2026-10-31T22:00:00.000Z",
    ],
  );
  assert.ok(events.every((event) => event.isFixture));
  assert.ok(events.every((event) => event.registrationUrl === null));
});
