# First-party source readiness — October 14–28, 2026

## October 28 implementation decision

Product Circle's strict dated event family is now enabled after an owner-run native capture passed every prepared condition. The accepted family is limited to lowercase `/events/<city>-<month>-<four-digit-year>` paths on `productcircle.co`; optional `www` is a retrieval alias only. The full suffix is the external identity.

The implementation updates JavaScript identity and public-link projection together with an additive PostgreSQL migration. Synthetic tests cover identity, aliases, tracking removal, distinct editions, deduplication, same-identity redirects, changed-edition rejection, unsafe paths, and JavaScript/PostgreSQL parity. It does not enable the other four organizer domains, run paid discovery, ingest or publish an event, or apply the migration to an existing database.

## October 14 spike decision

No new organizer domain is enabled by this spike. Product Circle is the only candidate with a sufficiently narrow, durable individual-event URL family, but the application's guarded native capture could not be verified from the current workspace. The integration therefore remains a prepared candidate rather than an enabled source.

This is a deliberate fail-closed result. Public page readability through an independent web index is not a substitute for proving that the application's DNS-pinned, size-bounded, redirect-limited capture path can retrieve and extract the page.

## Boundary

The spike examined only the five organizer-hosted pages in the October 14 PM cohort. It performed no paid search or extraction request, credential read, database write, migration application, registration, contact, publication or change to the active source allowlist.

One live native-capture preflight was attempted for Product Circle. The workspace returned `source_capture_fetch_failed` before any HTTP status, content type, response bytes or redirect was observed. A separately approved transport diagnostic confirmed that the current execution environment blocks `www.productcircle.co` at its network allowlist. This distinguishes the unresolved result from a page-level HTTP rejection, but it does not prove production capture compatibility.

## Candidate comparison

| Organizer candidate                                                                             | Observed public URL family                      | Identity assessment                                                                                                     | Capture/readiness decision                          |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [PaymentsFn 2026](https://paymentsfn.com/)                                                      | Root landing page                               | No individual event identity; likely to be reused                                                                       | Reject for registry support                         |
| [Genesys Xperience on Tour New York](https://www.genesys.com/events/xperience-on-tour-new-york) | `/events/<event-slug>`                          | Individual-looking path, but the slug omits the year and the directory contains many event types and localized variants | Defer pending stronger identity rule                |
| [Sprig Experience Research Summit NYC](https://sprig.com/summit/nyc)                            | `/summit/<city>`                                | City-only route can be reused; Sprig's 2025 summit used a different dated campaign route                                | Reject for registry support                         |
| [Product Circle New York](https://www.productcircle.co/events/new-york-november-2026)           | `/events/<city>-<month>-<year>`                 | Strongest candidate: current and archived pages consistently separate city, month and year                              | Ready for one native-capture preflight; not enabled |
| [monday.com Elevate](https://monday.com/elevate/)                                               | Reusable conference root with location subpages | One root currently represents NYC, EMEA, livestream and supporting content                                              | Reject for registry support                         |

Product Circle's current event directory exposes separate dated routes for New York and Lisbon in November 2026. Its archive also preserves distinct dated routes for Dublin, London, Bucharest, Zurich, Amsterdam, Boston and New York across 2025 and 2026. That supports a strict lowercase city–month–year identity rule and allows different editions to remain distinct.

The other four candidates do not currently justify an exception. A readable page and a relevant event are necessary but insufficient: the registry must distinguish one immutable event from a directory, recurring campaign or mutable city landing page before that URL can become stored identity or a public registration link.

## Implemented Product Circle boundary

The successful preflight authorized only this smallest supportable rule:

- exact host `productcircle.co`, with optional `www` only as a retrieval alias;
- exact `/events/` prefix;
- a lowercase `<city>-<month>-<four-digit-year>` suffix;
- the complete suffix retained as the external identity;
- directories, undated or season-based slugs, nested paths, encoded slugs, other subdomains, credentials, ports and non-HTTPS URLs rejected;
- private and tracking parameters removed before storage or retrieval; and
- redirects allowed only when they preserve the same canonical dated event.

The JavaScript source identity, public-link projection and optional Supabase `public_listing_url` function change together. Synthetic identity, redirect, deduplication and JavaScript/PostgreSQL parity tests accompany the change. The existing capture size, redirect, DNS, TLS, content, timeout and no-browser rules remain unchanged.

## Native proof — completed October 28

The Codex executor remained blocked by its network allowlist before HTTP. The repository owner therefore ran the prepared free preflight in a normal local Terminal, using the same native capture implementation and limits. It returned HTTP 200, `text/html`, 167,157 response bytes, zero redirects and 9,025 normalized text characters. The text exposed the Product Circle title, November 13, 2026 date and $579 price without login, browser rendering, cookies, credentials or limit changes.

The required conditions were:

1. preserve the canonical dated identity through no more than two redirects;
2. return supported public text content under the existing one-megabyte response limit;
3. extract non-challenge text under the existing 16,000-character limit;
4. expose the title, November 13, 2026 date and $579 price in the captured text; and
5. require no login, browser rendering, cookies, credentials or limit changes.

All conditions passed. There is still no browser fallback, proxy path or relaxed global capture limit. A future page outside the dated identity family remains unsupported, and any future capture that fails the ordinary safeguards must fail closed.

## Milestone implication

The source-identity gap is narrower: Product Circle's dated family can now participate in model-directed discovery and ordinary private capture/review. This is capability, not observed yield. No paid marketplace-versus-first-party comparison has run, no Product Circle draft exists from this change, and the seven-event human review and paid-discovery budget decision remain separate.
