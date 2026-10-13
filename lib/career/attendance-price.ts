export type AttendancePriceBand = "yes" | "maybe" | "no" | "unknown";

export const PILOT_ATTENDANCE_PRICE_SETTINGS = Object.freeze({
  version: "nyc-pilot-price-v1",
  currency_code: "USD",
  yes_max_cents: 15_000,
  maybe_max_cents: 25_000,
});

export const ATTENDANCE_PRICE_LABELS: Readonly<
  Record<Exclude<AttendancePriceBand, "unknown">, string>
> = Object.freeze({
  yes: "Within the provisional $0–$150 Yes range",
  maybe: "Within the provisional over-$150 through $250 Maybe range",
  no: "Above the provisional $250 attendance limit",
});

/** Classify a known USD price without treating missing or foreign prices as zero. */
export function attendancePriceBand(
  amountCents: number | null,
  currencyCode: string | null,
): AttendancePriceBand {
  if (
    amountCents === null ||
    !Number.isSafeInteger(amountCents) ||
    amountCents < 0 ||
    currencyCode !== PILOT_ATTENDANCE_PRICE_SETTINGS.currency_code
  )
    return "unknown";
  if (amountCents <= PILOT_ATTENDANCE_PRICE_SETTINGS.yes_max_cents)
    return "yes";
  if (amountCents <= PILOT_ATTENDANCE_PRICE_SETTINGS.maybe_max_cents)
    return "maybe";
  return "no";
}
