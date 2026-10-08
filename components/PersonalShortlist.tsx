"use client";

import {
  createContext,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createAttendanceStore } from "@/lib/attendance/store";
import type { AttendanceSnapshot } from "@/lib/attendance/store";
import {
  INTEREST_LABELS,
  isEventId,
  matchesInterest,
} from "@/lib/attendance/preferences";
import type {
  AttendanceScope,
  Interest,
  InterestFilter,
} from "@/lib/attendance/preferences";

type Store = ReturnType<typeof createAttendanceStore>;
const ChoiceContext = createContext<{
  choose: Store["choose"];
  snapshot: AttendanceSnapshot;
} | null>(null);
const persistenceMessages = {
  loading: "Loading your browser choices…",
  available:
    "Your choices stay in this browser; they aren’t sent to RightRoom.",
  unavailable:
    "Browser saving is unavailable. Choices last only while this page stays open.",
  clear_failed:
    "Saved choices couldn’t be cleared. Changes remain on this page; old choices may return after reload.",
  invalid:
    "Saved choices could not be read. Your next change will replace unreadable data for this edition.",
  full: "This browser list is full. Clear saved choices before adding another event.",
};

function browserStore(scope: AttendanceScope) {
  return createAttendanceStore(scope, {
    getStorage: () => window.localStorage,
    subscribe(receive) {
      const onStorage = (event: StorageEvent) => {
        try {
          if (event.storageArea === window.localStorage) receive(event);
        } catch {
          /* Storage access can be blocked by browser policy. */
        }
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
  });
}

/** Fixed choices only; no event facts, evidence or scores enter browser storage. */
export function AttendanceChoice({ eventId }: { eventId: string }) {
  const context = useContext(ChoiceContext);
  if (!context || !isEventId(eventId)) return null;
  const { snapshot, choose } = context;
  const selected = snapshot.choices.find(({ id }) => id === eventId)?.interest;
  return (
    <fieldset
      className="attendance-choice"
      aria-labelledby={`title-${eventId} choice-${eventId}`}
    >
      <legend id={`choice-${eventId}`}>My interest</legend>
      <div className="interest-buttons">
        {(Object.entries(INTEREST_LABELS) as [Interest, string][]).map(
          ([interest, label]) => (
            <button
              key={interest}
              type="button"
              aria-pressed={selected === interest}
              disabled={snapshot.persistence === "loading"}
              onClick={() =>
                choose(eventId, selected === interest ? null : interest)
              }
            >
              {label}
            </button>
          ),
        )}
      </div>
      <p>Not an RSVP. Select your choice again to clear it.</p>
    </fieldset>
  );
}

/** Filter server-rendered public cards; never fetch or reconstruct saved events. */
export function PersonalShortlist({
  items,
  scope,
  emptyState,
}: {
  items: readonly { id: string; content: ReactNode }[];
  scope: AttendanceScope;
  emptyState?: ReactNode;
}) {
  const store = useMemo(() => browserStore(scope), [scope]);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const [filter, setFilter] = useState<InterestFilter>("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const filterId = useId();
  const filterRef = useRef<HTMLSelectElement>(null);
  const visible = items.filter(({ id }) =>
    matchesInterest(id, filter, snapshot.choices),
  );
  const filters: [InterestFilter, string][] = [
    ["all", "All events"],
    ["interested", "Interested"],
    ["maybe", "Maybe"],
    ["not_for_me", "Not for me"],
    ["undecided", "Undecided"],
  ];
  const choose = (id: string, interest: Interest | null) => {
    store.choose(id, interest);
    if (!matchesInterest(id, filter, store.getSnapshot().choices))
      filterRef.current?.focus();
  };
  return (
    <ChoiceContext.Provider value={{ choose, snapshot }}>
      <div className="personal-shortlist">
        <div className="personal-filter-row">
          <label htmlFor={filterId}>Show</label>
          <select
            ref={filterRef}
            id={filterId}
            value={filter}
            disabled={snapshot.persistence === "loading"}
            onChange={(event) =>
              setFilter(event.target.value as InterestFilter)
            }
          >
            {filters.map(([value, label]) => (
              <option key={value} value={value}>
                {label} (
                {
                  items.filter(({ id }) =>
                    matchesInterest(id, value, snapshot.choices),
                  ).length
                }
                )
              </option>
            ))}
          </select>
          {(snapshot.choices.length > 0 ||
            snapshot.persistence === "invalid") && (
            <button
              type="button"
              className="clear-choices"
              onClick={() => setConfirmClear(true)}
            >
              Clear saved choices
            </button>
          )}
        </div>
        <p className="preference-notice" role="status">
          {persistenceMessages[snapshot.persistence]}
        </p>
        {scope !== "published" && (
          <p className="preference-notice">
            Sample choices are separate from published events.
          </p>
        )}
        {confirmClear && (
          <div
            className="clear-confirmation"
            role="group"
            aria-label="Confirm clearing choices"
          >
            <p>
              Clear all choices for this edition, including events no longer
              shown?
            </p>
            <button
              type="button"
              onClick={() => {
                store.clear();
                setFilter("all");
                setConfirmClear(false);
                filterRef.current?.focus();
              }}
            >
              Clear choices
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmClear(false);
                filterRef.current?.focus();
              }}
            >
              Keep choices
            </button>
          </div>
        )}
        {items.length > 0 && (
          <p className="filtered-count" role="status">
            Showing {visible.length} of {items.length} events. Original ranking
            retained.
          </p>
        )}
      </div>
      {items.length === 0 ? (
        emptyState
      ) : visible.length === 0 ? (
        <div className="feed-state filtered-empty">
          <h3>No events match this choice</h3>
          <p>Your choices don’t remove events from the published feed.</p>
          <button type="button" onClick={() => setFilter("all")}>
            Show all events
          </button>
        </div>
      ) : (
        <ol className="event-list">
          {visible.map(({ id, content }) => (
            <li key={id}>{content}</li>
          ))}
        </ol>
      )}
      <noscript>
        <p className="preference-notice">
          Enable JavaScript to save choices and filter this list. All events
          remain visible.
        </p>
      </noscript>
    </ChoiceContext.Provider>
  );
}
