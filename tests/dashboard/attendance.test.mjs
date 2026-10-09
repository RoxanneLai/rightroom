import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceStorageKey,
  isEventId,
  isInterest,
  matchesInterest,
  parseChoices,
  serializeChoices,
  updateChoices,
  PREFERENCE_LIMITS,
} from "../../lib/attendance/preferences.ts";
import {
  createAttendanceStore,
  canClearAttendance,
  INITIAL_ATTENDANCE,
} from "../../lib/attendance/store.ts";
import { restoreFilteredFocus } from "../../lib/attendance/focus.ts";

function browser() {
  const data = new Map();
  const listeners = new Set();
  const calls = [];
  let blocked = false;
  let writesBlocked = false;
  const storage = {
    getItem(key) {
      calls.push(["get", key]);
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (writesBlocked) throw new Error("PRIVATE QUOTA ERROR");
      calls.push(["set", key, value]);
      data.set(key, value);
    },
    removeItem(key) {
      if (writesBlocked) throw new Error("PRIVATE STORAGE ERROR");
      calls.push(["remove", key]);
      data.delete(key);
    },
  };
  const environment = {
    getStorage() {
      if (blocked) throw new Error("PRIVATE STORAGE ERROR");
      return storage;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    data,
    calls,
    listeners,
    environment,
    block(value) {
      blocked = value;
    },
    blockWrites(value) {
      writesBlocked = value;
    },
    event(key, newValue = null) {
      for (const listener of listeners) listener({ key, newValue });
    },
  };
}

function mount(scope = "published", state = browser()) {
  const store = createAttendanceStore(scope, state.environment);
  const unsubscribe = store.subscribe(() => {});
  return { store, state, unsubscribe };
}

test("attendance store construction and server snapshots never access browser storage", () => {
  const state = browser();
  const store = createAttendanceStore("published", state.environment);
  assert.equal(store.getServerSnapshot(), INITIAL_ATTENDANCE);
  assert.equal(store.getSnapshot(), INITIAL_ATTENDANCE);
  assert.equal(store.getSnapshot(), store.getSnapshot());
  assert.deepEqual(state.calls, []);
  const unsubscribe = store.subscribe(() => {});
  assert.equal(store.getSnapshot().persistence, "available");
  assert.equal(Object.isFrozen(store.getSnapshot().choices), true);
  assert.equal(state.listeners.size, 1);
  unsubscribe();
  assert.equal(state.listeners.size, 0);
});

test("fixed choices and stable public IDs reject hostile or unknown values", () => {
  for (const id of [
    "career-sample-0",
    "mock-product-003",
    "3de9cba1-4759-4b0f-8f65-e179a4f7567e",
  ])
    assert.equal(isEventId(id), true);
  for (const id of [
    "",
    "__proto__",
    "<script>",
    "https://luma.com/example",
    "x".repeat(161),
    null,
    42,
  ])
    assert.equal(isEventId(id), false);
  for (const value of ["interested", "maybe", "not_for_me"])
    assert.equal(isInterest(value), true);
  for (const value of ["Going", "constructor", "__proto__", "approved", null])
    assert.equal(isInterest(value), false);
});

test("versioned preference parsing rejects corrupt, duplicate, oversized and extra fields", () => {
  const item = { id: "event-1", interest: "maybe" };
  for (const value of [
    null,
    [],
    { version: 2, choices: [item] },
    { version: 1, choices: [item, item] },
    { version: 1, choices: [{ ...item, title: "PRIVATE TITLE" }] },
    { version: 1, choices: [item], evidence: "PRIVATE QUOTE" },
    { version: 1, choices: [null] },
    { version: 1, choices: [{ id: "__proto__", interest: "maybe" }] },
    { choices: [item] },
  ])
    assert.equal(parseChoices(JSON.stringify(value)), null);
  assert.equal(parseChoices("not JSON"), null);
  assert.equal(parseChoices(" ".repeat(PREFERENCE_LIMITS.bytes + 1)), null);
  const unicode = JSON.stringify({
    version: 1,
    choices: [],
    unknown: "界".repeat(30000),
  });
  assert.ok(unicode.length < PREFERENCE_LIMITS.bytes);
  assert.equal(parseChoices(unicode), null);
  assert.deepEqual(parseChoices(null), []);
  const parsed = parseChoices(JSON.stringify({ version: 1, choices: [item] }));
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed[0]), true);
});

test("changes preserve immutable input and filters preserve the original event order", () => {
  const original = Object.freeze([{ id: "event-2", interest: "maybe" }]);
  const changed = updateChoices(original, "event-1", "interested");
  assert.deepEqual(original, [{ id: "event-2", interest: "maybe" }]);
  const events = Object.freeze(["event-3", "event-1", "event-2"]);
  assert.deepEqual(
    events.filter((id) => matchesInterest(id, "all", changed)),
    events,
  );
  assert.deepEqual(
    events.filter((id) => matchesInterest(id, "maybe", changed)),
    ["event-2"],
  );
  assert.deepEqual(
    events.filter((id) => matchesInterest(id, "interested", changed)),
    ["event-1"],
  );
  assert.deepEqual(
    events.filter((id) => matchesInterest(id, "not_for_me", changed)),
    [],
  );
  assert.deepEqual(
    events.filter((id) => matchesInterest(id, "undecided", changed)),
    ["event-3"],
  );
  assert.deepEqual(updateChoices(changed, "event-1", null), original);
});

test("saving and reloading stores only IDs and choices, never event fields or filters", () => {
  const { store, state, unsubscribe } = mount();
  store.choose("event-1", "interested");
  store.choose("event-2", "not_for_me");
  const raw = state.data.get(attendanceStorageKey("published"));
  assert.deepEqual(JSON.parse(raw), {
    version: 1,
    choices: [
      { id: "event-1", interest: "interested" },
      { id: "event-2", interest: "not_for_me" },
    ],
  });
  assert.doesNotMatch(raw, /title|url|score|filter|quote|timestamp|reason/);
  unsubscribe();
  const loaded = mount("published", state);
  assert.deepEqual(
    loaded.store.getSnapshot().choices,
    store.getSnapshot().choices,
  );
  loaded.unsubscribe();
});

test("published, career sample and founder sample choices cannot affect each other", () => {
  const state = browser();
  const scopes = ["published", "sample-career", "sample-founder"];
  const mounted = scopes.map((scope) => mount(scope, state));
  mounted[0].store.choose("event-1", "interested");
  mounted[1].store.choose("event-1", "maybe");
  mounted[2].store.choose("event-1", "not_for_me");
  state.event(attendanceStorageKey("published"));
  assert.deepEqual(
    mounted.map(({ store }) => store.getSnapshot().choices[0].interest),
    ["interested", "maybe", "not_for_me"],
  );
  for (const entry of mounted) entry.unsubscribe();
});

test("blocked storage keeps choices usable on this page without exposing raw errors", () => {
  const state = browser();
  state.block(true);
  const { store, unsubscribe } = mount("published", state);
  store.choose("event-1", "maybe");
  store.choose("event-2", "interested");
  assert.equal(store.getSnapshot().persistence, "unavailable");
  assert.equal(store.getSnapshot().choices.length, 2);
  assert.doesNotMatch(JSON.stringify(store.getSnapshot()), /PRIVATE|ERROR/);
  store.choose("event-1", null);
  assert.deepEqual(store.getSnapshot().choices, [
    { id: "event-2", interest: "interested" },
  ]);
  assert.equal(state.data.size, 0);
  unsubscribe();
});

test("quota failures retain all unsaved decisions and merge them after saving recovers", () => {
  const { state, store, unsubscribe } = mount();
  store.choose("event-old", "maybe");
  state.blockWrites(true);
  store.choose("event-1", "interested");
  store.choose("event-2", "not_for_me");
  store.choose("event-old", null);
  assert.deepEqual(
    store.getSnapshot().choices.map(({ id }) => id),
    ["event-1", "event-2"],
  );
  assert.equal(store.getSnapshot().persistence, "unavailable");
  state.data.set(
    attendanceStorageKey("published"),
    serializeChoices([
      { id: "event-old", interest: "maybe" },
      { id: "event-other-tab", interest: "maybe" },
    ]),
  );
  state.event(attendanceStorageKey("published"));
  assert.equal(store.getSnapshot().choices.length, 3);
  assert.equal(
    store.getSnapshot().choices.some(({ id }) => id === "event-old"),
    false,
  );
  state.blockWrites(false);
  store.choose("event-3", "maybe");
  assert.equal(store.getSnapshot().persistence, "available");
  assert.equal(
    parseChoices(state.data.get(attendanceStorageKey("published"))).length,
    4,
  );
  unsubscribe();
});

test("corrupt storage is not overwritten during load or unrelated storage events", () => {
  const state = browser();
  const key = attendanceStorageKey("published");
  state.data.set(key, "CORRUPT PRIVATE DATA");
  const { store, unsubscribe } = mount("published", state);
  assert.equal(store.getSnapshot().persistence, "invalid");
  state.event("unrelated-key");
  assert.equal(state.calls.filter(([action]) => action === "set").length, 0);
  assert.equal(state.data.get(key), "CORRUPT PRIVATE DATA");
  store.choose("event-1", "maybe");
  assert.equal(store.getSnapshot().persistence, "available");
  assert.deepEqual(parseChoices(state.data.get(key)), [
    { id: "event-1", interest: "maybe" },
  ]);
  unsubscribe();
});

test("storage updates reread the latest value and sequential tab edits retain other IDs", () => {
  const state = browser();
  const first = mount("published", state);
  const second = mount("published", state);
  first.store.choose("event-1", "maybe");
  second.store.choose("event-2", "interested");
  state.event(attendanceStorageKey("published"), "obsolete-event-value");
  assert.deepEqual(
    first.store.getSnapshot().choices,
    second.store.getSnapshot().choices,
  );
  assert.equal(first.store.getSnapshot().choices.length, 2);
  state.data.delete(attendanceStorageKey("published"));
  state.event(null);
  assert.deepEqual(first.store.getSnapshot().choices, []);
  first.unsubscribe();
  second.unsubscribe();
});

test("clearing touches only its edition key and failed clears remain cleared in memory", () => {
  const { state, store, unsubscribe } = mount();
  state.data.set("another-application", "keep");
  state.data.set(attendanceStorageKey("sample-career"), "keep-sample");
  store.choose("event-1", "maybe");
  state.blockWrites(true);
  store.clear();
  assert.deepEqual(store.getSnapshot().choices, []);
  assert.equal(store.getSnapshot().persistence, "clear_failed");
  store.choose("event-2", "interested");
  assert.deepEqual(store.getSnapshot().choices, [
    { id: "event-2", interest: "interested" },
  ]);
  state.blockWrites(false);
  store.clear();
  assert.equal(state.data.has(attendanceStorageKey("published")), false);
  assert.equal(state.data.get("another-application"), "keep");
  assert.equal(
    state.data.get(attendanceStorageKey("sample-career")),
    "keep-sample",
  );
  unsubscribe();
});

test("entry and byte ceilings refuse additions without evicting existing decisions", () => {
  const choices = Array.from(
    { length: PREFERENCE_LIMITS.entries },
    (_, index) => ({ id: `event-${index}`, interest: "maybe" }),
  );
  assert.equal(updateChoices(choices, "new-event", "interested"), null);
  const { state, store, unsubscribe } = mount();
  state.data.set(attendanceStorageKey("published"), serializeChoices(choices));
  store.choose("new-event", "interested");
  assert.equal(store.getSnapshot().persistence, "full");
  assert.equal(store.getSnapshot().choices.length, PREFERENCE_LIMITS.entries);
  store.choose("event-1", null);
  store.choose("new-event", "interested");
  assert.equal(store.getSnapshot().persistence, "available");
  const long = choices.map((entry) => ({
    ...entry,
    id: entry.id + "a".repeat(150),
  }));
  assert.equal(serializeChoices(long), null);
  unsubscribe();
});

test("invalid programmatic choices neither read nor write storage", () => {
  const state = browser();
  const store = createAttendanceStore("published", state.environment);
  store.choose("__proto__", "maybe");
  store.choose("event-1", "approved");
  assert.deepEqual(state.calls, []);
  assert.equal(store.getSnapshot(), INITIAL_ATTENDANCE);
});

test("an unsaved decision cannot evict a newer tab's full list during reconciliation", () => {
  const { state, store, unsubscribe } = mount();
  state.blockWrites(true);
  store.choose("pending-event", "maybe");
  const latest = serializeChoices(
    Array.from({ length: PREFERENCE_LIMITS.entries }, (_, index) => ({
      id: `latest-${index}`,
      interest: "interested",
    })),
  );
  state.data.set(attendanceStorageKey("published"), latest);
  state.blockWrites(false);
  state.event(attendanceStorageKey("published"));
  store.choose("latest-0", "maybe");
  assert.equal(store.getSnapshot().persistence, "full");
  assert.equal(state.data.get(attendanceStorageKey("published")), latest);
  assert.deepEqual(store.getSnapshot().choices, [
    { id: "pending-event", interest: "maybe" },
  ]);
  unsubscribe();
});

test("pending removals free capacity before pending additions when reconciling another tab", () => {
  const state = browser();
  const key = attendanceStorageKey("published");
  const original = Array.from({ length: 499 }, (_, index) => ({
    id: `saved-${index}`,
    interest: "maybe",
  }));
  state.data.set(key, serializeChoices(original));
  const { store, unsubscribe } = mount("published", state);
  state.blockWrites(true);
  store.choose("pending-new", "interested");
  store.choose("saved-0", null);
  const latest = serializeChoices([
    ...original,
    { id: "other-tab-new", interest: "maybe" },
  ]);
  state.data.set(key, latest);
  state.event(key);
  assert.equal(store.getSnapshot().persistence, "unavailable");
  assert.equal(store.getSnapshot().choices.length, 500);
  assert.equal(
    store.getSnapshot().choices.some(({ id }) => id === "saved-0"),
    false,
  );
  assert.equal(
    store.getSnapshot().choices.some(({ id }) => id === "other-tab-new"),
    true,
  );
  assert.equal(state.data.get(key), latest);
  state.blockWrites(false);
  store.choose("saved-1", "interested");
  assert.equal(store.getSnapshot().persistence, "available");
  assert.equal(parseChoices(state.data.get(key)).length, 500);
  assert.equal(
    parseChoices(state.data.get(key)).some(({ id }) => id === "pending-new"),
    true,
  );
  unsubscribe();
});

test("expired saved IDs cannot add cards or inflate current-feed choice counts", () => {
  const choices = [{ id: "expired-event", interest: "interested" }];
  const current = ["current-1", "current-2"];
  assert.deepEqual(
    current.filter((id) => matchesInterest(id, "all", choices)),
    current,
  );
  assert.deepEqual(
    current.filter((id) => matchesInterest(id, "interested", choices)),
    [],
  );
  assert.deepEqual(
    current.filter((id) => matchesInterest(id, "undecided", choices)),
    current,
  );
  const state = browser();
  state.data.set(attendanceStorageKey("published"), serializeChoices(choices));
  const { store, unsubscribe } = mount("published", state);
  assert.deepEqual(store.getSnapshot().choices, choices);
  assert.equal(
    state.calls.some(([action]) => action !== "get"),
    false,
  );
  store.clear();
  assert.equal(state.data.has(attendanceStorageKey("published")), false);
  unsubscribe();
});

test("failed clears remain retryable with no in-memory choices and recover without an extra decision", () => {
  const { store, state, unsubscribe } = mount();
  assert.equal(canClearAttendance(store.getSnapshot()), false);
  store.choose("event-1", "maybe");
  state.blockWrites(true);
  store.clear();
  assert.equal(store.getSnapshot().choices.length, 0);
  assert.equal(canClearAttendance(store.getSnapshot()), true);
  assert.equal(state.data.has(attendanceStorageKey("published")), true);
  state.blockWrites(false);
  store.clear();
  assert.equal(canClearAttendance(store.getSnapshot()), false);
  assert.equal(store.getSnapshot().persistence, "available");
  assert.equal(state.data.has(attendanceStorageKey("published")), false);
  assert.equal(
    canClearAttendance({ choices: [], persistence: "invalid" }),
    true,
  );
  assert.equal(canClearAttendance(INITIAL_ATTENDANCE), false);
  unsubscribe();
});

test("external changes recover focus before a filtered card disappears without stealing unrelated focus", () => {
  let focuses = 0;
  const target = {
    focus() {
      focuses++;
    },
  };
  const active = {
    closest(selector) {
      assert.equal(selector, "[data-attendance-event]");
      return {
        getAttribute(name) {
          assert.equal(name, "data-attendance-event");
          return "event-1";
        },
      };
    },
  };
  const choices = [{ id: "event-1", interest: "maybe" }];
  restoreFilteredFocus(active, target, "interested", choices);
  assert.equal(focuses, 1);
  restoreFilteredFocus(active, target, "maybe", choices);
  restoreFilteredFocus(active, target, "all", choices);
  restoreFilteredFocus(null, target, "interested", choices);
  restoreFilteredFocus({ closest: () => null }, target, "interested", choices);
  restoreFilteredFocus(
    { closest: () => ({ getAttribute: () => "__proto__" }) },
    target,
    "interested",
    choices,
  );
  restoreFilteredFocus(active, null, "interested", choices);
  assert.equal(focuses, 1);
  restoreFilteredFocus(active, target, "undecided", []);
  assert.equal(focuses, 1);
  restoreFilteredFocus(active, target, "maybe", []);
  assert.equal(focuses, 2);
});
