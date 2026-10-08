# Personal attendance shortlist

## What it does

Each currently displayed card has **Interested**, **Maybe**, and **Not for me** buttons. Select a choice again to return the event to Undecided. The Show filter selects All events, Interested, Maybe, Not for me, or Undecided, with counts for the events loaded in this edition.

The filter preserves original ranks, scores and order. The page summary and shortlist heading count available events, while the filter's status states how many are visible. A choice does not register, RSVP, contact a host, establish attendance eligibility, approve publication, change discovery exclusions, retrain ranking or trigger a paid request.

Only events already supplied by the server can appear. A saved ID cannot recover an expired event, reveal a draft, add an event excluded from the career feed or turn an unavailable database into a personal feed. The existing fifty-event public-query limit remains; this is not pagination or a full saved-events archive. Existing empty/error/loading states remain distinct.

## Storage and privacy

Preferences use browser `localStorage` on the current origin, not SQLite, Supabase, cookies or an account. The payload contains only a version and stable event IDs with fixed choices. It does not contain titles, registration URLs, source evidence, scores, reasons, timestamps, resume details or a profile. No preference API, telemetry or analytics was added; choices are not submitted to RightRoom. Ordinary page requests and registration links still work normally.

Published `/`, `/career` and `/events` share one preference key. Fictional `/sample/career` and `/sample` each have a separate key. Sample practice therefore cannot influence published decisions. Origins are distinct: `localhost` and `127.0.0.1`, different ports, schemes or hosted deployments do not share choices.

| Edition        | Own key                                  |
| -------------- | ---------------------------------------- |
| Published      | `rightroom:attendance:published:v1`      |
| Career sample  | `rightroom:attendance:sample-career:v1`  |
| Founder sample | `rightroom:attendance:sample-founder:v1` |

The filter itself resets to All events on a fresh page load; saved choices survive when browser storage is available. There is no cross-device/account sync, export or backup. Clearing site storage or ending a private-browsing session can lose choices. Local storage is not encrypted or protected from other code on the same origin or someone using the same browser profile; use a separate profile on a shared computer if needed.

Old event IDs remain until explicitly cleared, but cannot create cards or count toward current-feed filters. Storage is versioned and bounded to 500 choices / 64 KiB of UTF-8 JSON. Unknown versions/fields, duplicate or malformed IDs, unknown choices, invalid JSON and oversized data fail safely. Corrupt storage is not rewritten on page load; the UI warns before a deliberate next change replaces unreadable data. A full list refuses additions without silently evicting existing decisions.

## Failure, reset and multiple tabs

- Blocked storage or quota errors do not stop reading cards, making choices or filtering. The UI warns that unsaved choices last only while the page remains open. They are held in memory, including removals, and merged on a later successful explicit save rather than silently lost after a second click.
- Clear saved choices opens an inline confirmation. Keep choices cancels; Clear choices removes only the current edition's key, resets its in-memory choices and returns the filter to All events. Other editions and applications are untouched. A failed removal explicitly warns that old saved choices may return after reload.
- Sequential same-origin tab edits reread current storage and retain other IDs. Storage events refresh other open tabs. Browser storage has no atomic multi-tab transaction: truly simultaneous conflicting writes can be last-write-wins. This is not a collaborative or account-backed preference service. If reconciling unsaved choices would overflow a newer saved list, the application refuses to overwrite it.
- With JavaScript disabled, all server-rendered public/sample cards remain readable. Controls stay disabled and a no-script explanation appears. Server rendering and initial hydration use the same empty/loading preference snapshot and never read browser storage or save an empty list over existing choices.

Buttons have fixed labels, event-specific group names and pressed states. Native filter controls and buttons support keyboard operation. Removing the focused card from a filtered list returns focus to the filter; confirmed/cancelled clearing also returns focus there. Status messages describe filtered counts and storage failures without altering eligibility cautions. Choice buttons have at least 44-pixel height and wrap on narrow screens.

## Implementation boundary

`components/Dashboard.tsx` remains a Server Component, and `EventCard.tsx` remains server-rendered. A small `PersonalShortlist` Client Component receives stable IDs and rendered public-card slots, not a storage repository or private source records. Its nested `AttendanceChoice` controls use client context. Pure preference validation/filtering and an injectable browser-store adapter live in `lib/attendance/`.

No provider, ingestion, database schema, publication or scoring changes are part of this increment. In particular, it does not resolve the [PM discovery cost-bound decision](PM-COST-FEASIBILITY.md).

## Verification checkpoint — October 8, 2026

Normal offline tests cover strict storage parsing, immutable filtering, persistence/reload, edition isolation, blocked/quota-failed storage, pending removals, cross-tab rereads, scoped reset, capacity and safe server snapshots. Production checks cover complete server-visible cards with safe hydration defaults and preserved public-only database projection.

Verification passed formatting, lint, TypeScript, all 304 normal offline tests (6 unit, 249 ingestion, 36 dashboard, 13 review), a production build, 4 compiled-page checks, 14 runtime checks and `git diff --check`. Fourteen new normal tests cover attendance preferences. Browser checks confirmed reload persistence, original rank retention, Space-key toggle/focus recovery, cancellation and confirmed clearing, separate sample editions, cross-tab updates, and a 390-pixel mobile viewport without horizontal overflow. A final sample screenshot is retained locally under ignored `codex-tmp/attendance-verification/`.

Browser interaction checks use a production build in a credential-free copy under ignored `codex-tmp/`, with fictional samples and isolated storage. They cover choices, reload persistence, filters/empty-filter recovery, keyboard focus, cancel-clear, cross-tab updates and mobile overflow. Screenshots and logs remain local, not committed. This is functional verification, not user usefulness validation or live discovery acceptance. No real event, existing database, credentials or paid API is used. Changes remain uncommitted for human review.
