import assert from "node:assert/strict";
import test from "node:test";
import { PM_REQUEST_LIMITS } from "../../lib/ingestion/acceptance-budget.ts";
import { measurePmRequests } from "./pm-cost-bound-helpers.mjs";

test("real PM provider payloads include repeated schemas and bounded three-page evidence without hidden-tool measurements", async () => {
  const measured = await measurePmRequests();
  assert.deepEqual(
    measured.map(({ phase }) => phase),
    ["research", "extraction", "repair"],
  );
  for (const entry of measured) {
    assert.ok(entry.body_bytes <= PM_REQUEST_LIMITS[entry.phase].body_bytes);
    assert.ok(
      entry.message_bytes <= PM_REQUEST_LIMITS[entry.phase].message_bytes,
    );
    assert.equal(entry.server_tool_count, entry.phase === "research" ? 1 : 0);
    assert.equal(entry.max_tool_calls, entry.phase === "research" ? 3 : 0);
    if (entry.phase !== "research") {
      assert.ok(entry.schema_bytes > 0);
      assert.equal(entry.schema_in_system_message, true);
    }
    assert.equal("input_tokens" in entry, false);
  }
});

test("UTF-16 character caps do not imply equal UTF-8 request or message sizes", async () => {
  const ascii = await measurePmRequests("a");
  for (const pattern of ["界", "😀", "\u0001"]) {
    const measured = await measurePmRequests(pattern);
    const extraction = measured[1];
    assert.ok(extraction.body_bytes > ascii[1].body_bytes);
    assert.ok(extraction.message_bytes > ascii[1].message_bytes);
    assert.ok(extraction.body_bytes <= PM_REQUEST_LIMITS.extraction.body_bytes);
    assert.ok(
      extraction.message_bytes <= PM_REQUEST_LIMITS.extraction.message_bytes,
    );
  }
});
