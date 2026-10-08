import {
  attendanceStorageKey,
  isEventId,
  isInterest,
  parseChoices,
  serializeChoices,
  updateChoices,
} from "./preferences.ts";
import type { AttendanceScope, Choice, Interest } from "./preferences.ts";

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StorageUpdate = Readonly<{ key: string | null; newValue: string | null }>;
export type AttendanceEnvironment = {
  getStorage: () => BrowserStorage;
  subscribe: (receive: (update: StorageUpdate) => void) => () => void;
};
type Persistence =
  "loading" | "available" | "unavailable" | "clear_failed" | "invalid" | "full";
export type AttendanceSnapshot = Readonly<{
  choices: readonly Choice[];
  persistence: Persistence;
}>;
export const INITIAL_ATTENDANCE: AttendanceSnapshot = Object.freeze({
  choices: Object.freeze([]),
  persistence: "loading",
});

/** Isolated browser preferences: no storage access during construction or SSR. */
export function createAttendanceStore(
  scope: AttendanceScope,
  environment: AttendanceEnvironment,
) {
  const key = attendanceStorageKey(scope);
  let snapshot = INITIAL_ATTENDANCE;
  const listeners = new Set<() => void>();
  let disconnect: (() => void) | null = null;
  const pending = new Map<string, Interest | null>();
  let pendingClear = false;
  const emit = (choices: readonly Choice[], persistence: Persistence) => {
    snapshot = Object.freeze({ choices, persistence });
    for (const listener of listeners) listener();
  };
  const withPending = (saved: readonly Choice[]): readonly Choice[] | null => {
    let choices = pendingClear
      ? (Object.freeze([]) as readonly Choice[])
      : saved;
    for (const [id, interest] of pending) {
      const updated = updateChoices(choices, id, interest);
      if (!updated) return null;
      choices = updated;
    }
    return choices;
  };
  const read = (): readonly Choice[] | null => {
    try {
      const choices = parseChoices(environment.getStorage().getItem(key));
      if (choices === null) {
        emit(snapshot.choices, "invalid");
        return snapshot.choices;
      }
      const current = withPending(choices);
      if (!current || serializeChoices(current) === null) {
        emit(snapshot.choices, "full");
        return null;
      }
      emit(
        current,
        pendingClear
          ? "clear_failed"
          : pending.size
            ? "unavailable"
            : "available",
      );
      return current;
    } catch {
      emit(snapshot.choices, pendingClear ? "clear_failed" : "unavailable");
      return snapshot.choices;
    }
  };
  const receive = (update: StorageUpdate) => {
    if (update.key !== null && update.key !== key) return;
    // Reread current storage rather than applying potentially delayed event data.
    read();
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL_ATTENDANCE,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        read();
        try {
          disconnect = environment.subscribe(receive);
        } catch {
          disconnect = null;
        }
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          disconnect?.();
          disconnect = null;
        }
      };
    },
    choose(id: string, interest: Interest | null) {
      if (!isEventId(id) || (interest !== null && !isInterest(interest)))
        return;
      // Merge the latest same-origin choices before replacing this single ID.
      const current = read();
      if (!current) return;
      const choices = updateChoices(current, id, interest);
      const raw = choices ? serializeChoices(choices) : null;
      if (!choices || !raw) {
        emit(snapshot.choices, "full");
        return;
      }
      try {
        environment.getStorage().setItem(key, raw);
        pending.clear();
        pendingClear = false;
        emit(choices, "available");
      } catch {
        pending.set(id, interest);
        emit(choices, pendingClear ? "clear_failed" : "unavailable");
      }
    },
    clear() {
      try {
        environment.getStorage().removeItem(key);
        pending.clear();
        pendingClear = false;
        emit(Object.freeze([]), "available");
      } catch {
        pending.clear();
        pendingClear = true;
        emit(Object.freeze([]), "clear_failed");
      }
    },
  };
}
