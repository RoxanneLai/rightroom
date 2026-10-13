# Manual PM validation sprint — October 13, 2026

## Purpose

Test whether RightRoom helps the user distinguish useful product-career events before investing in another automated discovery integration. This is a manual, source-linked product evaluation, not an ingestion run or a claim that the current numerical scores are calibrated.

The evaluation window is October 13 through November 12, 2026, matching the default 30-day career horizon. Every candidate is an upcoming physical New York City event with a current public listing. The set intentionally includes direct product relevance, technical adjacency, and practical-access friction.

No registration, payment, host contact, database write, publication, credential read, or paid API request is part of this sprint. Availability and listing facts can change after the October 13 source check.

## Candidate set

| Candidate                                                                                          | Date and place                     | Why it tests the product                                                                                                                                                                                                    | Attendance caveat                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Double Diamond — October 2026](https://luma.com/double-diamond-oct-2026)                          | October 22, 6–11 PM; New York City | Direct product/design signal: a Head of Product is speaking, the audience targets product builders and design leaders, and the agenda includes a happy hour and open hang.                                                  | Host approval is required and the exact address is hidden until registration. The audience is intentionally curated, and the public listing does not display a ticket price.                              |
| [New York App Week by RevenueCat: IndieDev Talks](https://www.meetup.com/iosoho/events/316478632/) | October 19, 6–9 PM; 307 W 38th St  | Technical-adjacent comparison: an engineering-community event whose first talk covers idea validation, user search demand, pricing, paywall testing, analytics, and product growth; scheduled networking begins at 7:45 PM. | An ID is requested. The second talk remains unannounced, and the listing does not establish price or current space availability.                                                                          |
| [Horizons New York: AI + Digital Innovation](https://brainstation.io/horizons/new-york)            | October 29, 3–7 PM; 136 Crosby St  | Strong named-people and product-leadership signal: the published lineup includes senior product leaders from NVIDIA, BNY, and Mastercard, with a dedicated networking reception.                                            | The listed ticket price is $475. The event describes a curated audience of executives and digital leaders and uses a request-tickets flow, making fit and practical value uncertain for a career entrant. |

## Evidence notes

### Double Diamond

The primary Luma listing showed 104 people going when checked. It names Alex Leiphart, Partner and Head of Product at Little Plains, alongside two product founders. The organizer describes the event as an NYC series for product and design practitioners building with AI. Its agenda provides 75 minutes for arrivals and a happy hour, followed by talks and an open hang. These are advertised opportunities, not guaranteed conversations or hiring access.

### RevenueCat IndieDev Talks

The Meetup listing identifies iOSoho as the organizer and RevenueCat as the venue sponsor. Jennifer Brisbane's talk promises practical ways to validate an idea, understand user search behavior, choose what to build, and test pricing and paywalls. The listing identifies her as an engineer and indie developer working across the full product lifecycle. This supports adjacent product practice, but not a dedicated PM audience or named hiring opportunity.

### Horizons New York

The BrainStation listing names Sebastian Misiurek, Senior Product Manager at NVIDIA; Christi Fisher, Global Head of Product and Process Transformation at BNY; and Michael K. Wagner, Vice President of Product Excellence at Mastercard. It promises panels and networking, but the $475 cost and executive curation are substantial practical-access cautions. A prestigious lineup alone does not establish that the event is the best career room for this user.

## User evaluation

For each candidate, collect:

1. `Yes`, `Maybe`, or `No` for attending.
2. The main reason for that decision.
3. An overall rank from first to third.
4. Whether a clearly headed attendance section near the fit score would change or clarify the decision.

Do not show or calculate a new score before collecting this response. The first pass should measure the user's judgment without anchoring it to the application's number.

### First-pass decisions — October 13, 2026

| Candidate                                       | Decision           | User's stated reason                                  |
| ----------------------------------------------- | ------------------ | ----------------------------------------------------- |
| Double Diamond — October 2026                   | Yes; first choice  | It is product/design focused and includes networking. |
| New York App Week by RevenueCat: IndieDev Talks | Yes; second choice | It covers product growth and scheduled networking.    |
| Horizons New York: AI + Digital Innovation      | Maybe              | The ticket price.                                     |

These unanchored decisions establish that the first two candidates clear the user's initial attendance threshold, with Double Diamond preferred because it combines direct product/design focus with networking. RevenueCat ranks second because its product-growth content and scheduled networking are useful despite the event's engineering-community context. Horizons remains relevant enough for `Maybe`, but its $475 price materially reduces attendance intent. This is evidence that practical access must remain distinct and prominent rather than being hidden inside an overall relevance score. It does not prove that any current numerical score is calibrated.

The existing clearly headed attendance section remains the presentation boundary for practical-access guidance; the user did not request a new relevance-weighting rule.

### Price-band follow-up — October 13, 2026

The user supplied these personal attendance bands:

- `Yes`: $0 through $150, inclusive;
- `Maybe`: above $150 through $250, inclusive; and
- `No`: above $250.

Applying the explicit band to Horizons' listed $475 price refines the earlier qualitative `Maybe` to `No`. The original first-pass response remains recorded above rather than being silently rewritten. Double Diamond and RevenueCat have unknown public prices, so this rule cannot classify their affordability until a price is verified.

The user approved these bands as provisional shared settings for the NYC pilot. They are displayed separately in **Attendance & eligibility** and do not alter the career-fit score, stored assessment, ranking or historical records. Only known USD prices are classified; missing, malformed and non-USD prices remain outside the bands rather than being treated as free.

## Offline version 4 comparison — October 13, 2026

After collecting the unanchored decisions, the three current listings were projected through the actual version 4 assessment function using conservative, manually selected facts and exact listing excerpts. This was not a model extraction, ingestion run, new draft or production score. It made no network request, credential read, database access or publication change. The projection tests how the deterministic evidence gates and weights respond if those supported facts are extracted.

| Candidate                 | User order | Projected score | Role | People | Interaction | Domain | Access |
| ------------------------- | ---------: | --------------: | ---: | -----: | ----------: | -----: | -----: |
| Double Diamond            |          1 |              25 |    0 |     25 |           0 |      0 |      0 |
| RevenueCat IndieDev Talks |          2 |              70 | 22.5 |     25 |          20 |      0 |    2.5 |
| Horizons New York         |          3 |            47.5 |    0 |     25 |          20 |      0 |    2.5 |

The projected order, RevenueCat then Horizons then Double Diamond, does not match the user's order. Three bounded gaps explain most of the mismatch:

- Version 4 does not recognize an event for `product and design practitioners` or `product builders` as direct product-role evidence. Double Diamond therefore receives no role credit even though that focus is the user's primary reason for ranking it first.
- Version 4 requires explicit networking language. Double Diamond's agenda advertises a happy hour and open hang, which the user treats as networking, but neither phrase receives interaction credit.
- A known paid price receives no free-admission bonus, but even a $475 price creates no fixed assessment caution or negative score. The new provisional price guidance instead shows it as above the user's attendance limit without changing relevance or rewriting assessments.

This is sufficient evidence of a calibration gap, not sufficient evidence for a broad keyword expansion or new weights. Version 5 therefore makes only the two observed, event-scoped vocabulary changes below. Price remains a separate attendance signal under the approved provisional bands, and historical assessments remain unchanged.

## Bounded version 5 calibration

Version 5 recognizes an explicit current-event audience of `product practitioners`, `product and design practitioners`, or `product builders` as direct product evidence when the model already labeled the fact direct. It also recognizes a scheduled `happy hour` or `open hang` as networking when its own clause includes an agenda, invitation or clock-time context. It does not upgrade adjacent, none or unknown model labels.

The new rules reject bare social keywords, recurring-community and past-event copy, cancelled or absent activities, talks about happy-hour/open-hang formats, product-builder tools or merchandise, speaker biographies, and evidence borrowed from another quote. The component weights and price treatment are unchanged.

The same conservative facts and listing excerpts used for the version 4 comparison produce:

| Candidate                 | User order | Version 4 | Version 5 | Role | People | Interaction | Domain | Access |
| ------------------------- | ---------: | --------: | --------: | ---: | -----: | ----------: | -----: | -----: |
| Double Diamond            |          1 |        25 |        75 |   30 |     25 |          20 |      0 |      0 |
| RevenueCat IndieDev Talks |          2 |        70 |        70 | 22.5 |     25 |          20 |      0 |    2.5 |
| Horizons New York         |          3 |      47.5 |      47.5 |    0 |     25 |          20 |      0 |    2.5 |

The relevance order now matches the user's first-through-third ordering. This is one three-event calibration check, not evidence that the numerical gaps are generally calibrated or that any event will produce career outcomes. Horizons' $475 price still changes its separate provisional attendance decision to `No`; it does not reduce the relevance score. New assessments carry `career-score-v5`; saved versions 1 through 4 are still read with their original scores and are not migrated or refreshed.

Offline verification passed all 313 deterministic tests, lint, TypeScript, formatting, diff validation, a clean production build, 4 compiled-page checks and 15 runtime checks. The checks include positive and false-positive vocabulary cases plus mixed version 1 through 5 reads. No paid call, credential read, database write, real-event refresh or publication was performed.

## Sprint exit criteria

This sprint is complete when:

- all three events have a decision and reason;
- the user supplies a relative ordering, including ties if appropriate;
- attendance friction is separated from career relevance in the recorded reasoning;
- the results are compared with version 4 and the bounded version 5 calibration offline, without rewriting historical assessments; and
- any ranking or attendance-UI change is justified by the observed decisions rather than by the desire to produce a higher score.

Finding no event worth attending is a valid result. It should change the target or sourcing strategy, not trigger an automatic paid search.
