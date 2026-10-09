import { isEventId, matchesInterest } from "./preferences.ts";
import type { Choice, InterestFilter } from "./preferences.ts";

/** Move keyboard focus only when its card will disappear under the active filter. */
export function restoreFilteredFocus(
  activeElement: Pick<Element, "closest"> | null,
  filterControl: Pick<HTMLElement, "focus"> | null,
  filter: InterestFilter,
  choices: readonly Choice[],
): void {
  const id = activeElement
    ?.closest("[data-attendance-event]")
    ?.getAttribute("data-attendance-event");
  if (isEventId(id) && !matchesInterest(id, filter, choices))
    filterControl?.focus();
}
