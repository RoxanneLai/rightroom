import { z } from "zod";
import configured from "../config/event-sources.json" with { type: "json" };

const identityPatternSchema = z.enum([
  "W[0-9]{10}",
  "[a-z]+(?:-[a-z]+)*-(?:january|february|march|april|may|june|july|august|september|october|november|december)-[0-9]{4}",
]);

const entrySchema = z
  .object({
    host: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
    prefix: z.string().regex(/^\/[a-z0-9/-]+$/),
    identity_parameter: z.literal("eventId").nullable(),
    identity_pattern: identityPatternSchema.optional(),
  })
  .strict()
  .refine(
    (entry) => !entry.identity_pattern || entry.identity_parameter === null,
  );
export const ORGANIZER_SOURCES = z.array(entrySchema).max(20).parse(configured);

/** Only registry-approved individual paths; remove all nonidentity parameters. */
export function organizerListing(
  input: URL,
): { url: string; externalId: string | null } | null {
  const url = new URL(input);
  const entry = ORGANIZER_SOURCES.find((item) => item.host === url.hostname);
  if (!entry) return null;
  const suffix = url.pathname.slice(entry.prefix.length);
  let externalId: string | null = null;
  if (entry.identity_parameter) {
    if (
      url.pathname !== entry.prefix ||
      url.searchParams.getAll(entry.identity_parameter).length !== 1 ||
      !/[?&]eventId=[0-9]{1,12}(?:&|$)/.test(url.search) ||
      /[?&][^=&]*%[^=&]*=/.test(url.search)
    )
      return null;
    externalId = url.searchParams.get(entry.identity_parameter);
    if (!externalId || !/^\d{1,12}$/.test(externalId)) return null;
  } else if (
    !url.pathname.startsWith(entry.prefix) ||
    !/^[A-Za-z0-9_-]+$/.test(suffix)
  )
    return null;
  if (entry.identity_pattern) {
    if (!new RegExp("^" + entry.identity_pattern + "$").test(suffix))
      return null;
    externalId = suffix;
  }
  url.search = "";
  if (externalId && entry.identity_parameter)
    url.searchParams.set(entry.identity_parameter, externalId);
  url.hash = "";
  return { url: url.toString(), externalId };
}
