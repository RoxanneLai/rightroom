export const INTEREST_LABELS = {
  interested: "Interested",
  maybe: "Maybe",
  not_for_me: "Not for me",
} as const;
export type Interest = keyof typeof INTEREST_LABELS;
export type InterestFilter = "all" | "undecided" | Interest;
export type AttendanceScope = "published" | "sample-career" | "sample-founder";
export type Choice = Readonly<{ id: string; interest: Interest }>;
export const PREFERENCE_LIMITS = { entries: 500, bytes: 65536 } as const;

export function attendanceStorageKey(scope: AttendanceScope): string {
  return `rightroom:attendance:${scope}:v1`;
}

/** Only public stable IDs and fixed choices belong in browser storage. */
export function isEventId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)
  );
}

export function isInterest(value: unknown): value is Interest {
  return typeof value === "string" && Object.hasOwn(INTEREST_LABELS, value);
}

/** Reject unknown fields, duplicate IDs and oversized/unversioned storage. */
export function parseChoices(raw: string | null): readonly Choice[] | null {
  if (raw === null) return Object.freeze([]);
  if (
    raw.length > PREFERENCE_LIMITS.bytes ||
    new TextEncoder().encode(raw).byteLength > PREFERENCE_LIMITS.bytes
  )
    return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "choices,version" ||
    record.version !== 1 ||
    !Array.isArray(record.choices) ||
    record.choices.length > PREFERENCE_LIMITS.entries
  )
    return null;
  const ids = new Set<string>();
  const choices: Choice[] = [];
  for (const item of record.choices) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    if (
      Object.keys(entry).sort().join(",") !== "id,interest" ||
      !isEventId(entry.id) ||
      !isInterest(entry.interest) ||
      ids.has(entry.id)
    )
      return null;
    ids.add(entry.id);
    choices.push(Object.freeze({ id: entry.id, interest: entry.interest }));
  }
  return Object.freeze(choices);
}

export function serializeChoices(choices: readonly Choice[]): string | null {
  const raw = JSON.stringify({ version: 1, choices });
  return parseChoices(raw) === null ? null : raw;
}

/** Filtering preserves original ranks/order and never adds records from saved IDs. */
export function matchesInterest(
  id: string,
  filter: InterestFilter,
  choices: readonly Choice[],
): boolean {
  const interest = choices.find((choice) => choice.id === id)?.interest;
  return (
    filter === "all" ||
    (filter === "undecided" ? interest === undefined : interest === filter)
  );
}

export function updateChoices(
  choices: readonly Choice[],
  id: string,
  interest: Interest | null,
): readonly Choice[] | null {
  if (!isEventId(id) || (interest !== null && !isInterest(interest)))
    return null;
  const updated = choices.filter((choice) => choice.id !== id);
  if (interest !== null) updated.push(Object.freeze({ id, interest }));
  return updated.length <= PREFERENCE_LIMITS.entries
    ? Object.freeze(updated)
    : null;
}
