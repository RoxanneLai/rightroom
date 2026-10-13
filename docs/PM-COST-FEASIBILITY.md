# PM discovery cost-bound feasibility — October 7, 2026

## Decision

**No defensible smaller whole-attempt reservation was established for the current hosted-search workflow.** Keep the $0.15 ceiling, corrected full-context reservation and refusal unchanged. This investigation does not establish that an ordinary run costs $3.2466, authorize a larger budget, or launch a paid attempt.

The investigation starts from `a9eb787` on `codex/pm-discovery-plan`. It traces the real request builder and strict acceptance transport, exercises synthetic requests offline, and checks public documentation. Production code, model/effort, prompts, output allowances, search settings, schemas, repair behavior and publication rules are unchanged. No credential, existing database, event listing, account setting or authenticated endpoint was accessed.

## What the application can control

| Phase              | Observable and enforced locally                                                                                                                                                                           | Not established by those controls                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Research           | Two text messages; pinned Exa Auto; three tool steps/searches; five results per search, fifteen total; 2,000 content characters per result; 6,000 output-token allowance; outgoing body/message byte caps | Complete billable input and output for every gateway continuation, including provider formatting, tool definitions, result metadata and accumulated history |
| Extraction         | Up to three independently captured pages for this plan; at most 16,000 UTF-16 code units per page; bounded report; explicit strict schema; no tools; 12,000 output-token allowance; outgoing byte caps    | Exact billed representation after gateway/provider processing; a verified tokenizer and formatting bound                                                    |
| Conditional repair | One call, no tools; at most 60,000 UTF-16 code units of malformed extraction; exact source set and schema; 6,000 output-token allowance; fact-preservation validation and outgoing byte caps              | Exact billed representation and an independently justified smaller input reservation                                                                        |

Research byte caps apply to the initial outgoing request, not the hidden transcript that OpenRouter creates after tools execute. Source-capture byte/character caps apply to extraction evidence, not hosted-search metadata. Extraction and repair repeat the required schema in the system message and `response_format`; counting user text alone misses that duplication.

OpenRouter documents limits on search calls, cumulative results and result **content**, with model-token charges separate from Exa fees. Those controls do not document a cap on every result URL/title, provider wrapper or complete continuation input. The current Exa Auto price shown during this documentation check is $0.007 per search; five results per call are below the included ten. That human-readable page is not an authoritative runtime tariff. The runner now records $0.007 only as an unverified estimate and refuses paid execution with `acceptance_search_tariff_unverified` if the model-only envelope ever passes. [OpenRouter web search](https://openrouter.ai/docs/guides/features/server-tools/web-search).

OpenAI's exact token-count endpoint includes message formatting and supports tools; local plain-text counting does not completely account for schemas and model-specific processing. That endpoint describes the direct Responses API. It is not evidence of an equivalent credential-free count for this OpenRouter Chat Completions request or its later hidden turns. No tokenizer dependency, counting endpoint, credential or new request was added. [OpenAI token counting](https://developers.openai.com/api/docs/guides/token-counting).

## Arithmetic: where the reservation blocks progress

These are **dated illustrative catalog rates**, not a new gateway quote: context 1,050,000; highest full input-category rate $0.50/million; highest output rate $1.80/million. The [Luna model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna) lists the context, base rates, long-prompt multipliers and full cache-write multiplier. The actual runner still obtains its prices through its existing catalog gates.

| Scenario                                              | Reserved dollars | Meaning                                                                           |
| ----------------------------------------------------- | ---------------: | --------------------------------------------------------------------------------- |
| Existing complete attempt                             |           3.2466 | Four research passes, extraction, conditional repair and three searches           |
| Remove repair entirely                                |           2.7108 | Counterfactual; still over budget, changes compatibility behavior                 |
| Make extraction and repair entirely free              |           2.1642 | Research reservation alone still exceeds $0.15                                    |
| One full-context research pass plus three search fees |           0.5568 | Counterfactual; not a valid bound for a three-step hosted loop, still over budget |

The complete attempt allows 42,000 output tokens across the reserved passes: four times 6,000 for research, 12,000 for extraction and 6,000 for repair. At the dated highest output rate, outputs plus three Exa searches reserve $0.0966. This leaves $0.0534 for all input: at $0.50/million, **106,800 input tokens summed across every pass**, or 17,800 per pass if distributed equally over six passes. The equal distribution is illustrative, not a requirement or enforced gateway limit. Integer microdollars reproduce these amounts without downward rounding.

A proof would therefore need to bound the whole accumulated input, not merely count the first research prompt or shorten extraction. This is a limitation of the available proof, not evidence that live inputs actually reach full contexts. No character-to-token ratio, cache-hit expectation or historical $0.03-ish bill is substituted for an upper bound. Lowering output limits alone cannot fix the retained full-context research input reservation either.

## Offline payload measurements

The real provider was given only injected HTTP replies and synthetic data: a three-source PM plan, fifty 2,000-character exclusion URLs, a 40,000-code-unit report, three 16,000-code-unit captured pages and a 60,000-code-unit malformed response to exercise one bounded repair. The malformed repair reply is intentionally rejected. This tests request construction, not model quality or the attainability of every synthetic content cap under output-token limits.

These byte counts precede the acceptance transport's routing-price injection. They are not billed tokens or worst-case gateway inputs. Only aggregate sizes leave the helper; source text, prompts, response bodies, headers and reasoning traces are not saved in the measurement report.

| Synthetic padding               | Extraction body bytes | Extraction decoded-message bytes |
| ------------------------------- | --------------------: | -------------------------------: |
| ASCII                           |               114,985 |                          103,313 |
| CJK                             |               287,811 |                          276,139 |
| Supplementary-plane characters  |               201,395 |                          189,723 |
| JSON-escaped control characters |               633,463 |                          535,378 |

All four samples fit the existing extraction byte caps. Research was 106,587 body bytes / 105,792 message bytes; repair was 83,800 / 71,110. Each extraction/repair schema was 9,422 bytes and appeared in both the system message and response-format field. Identical character caps therefore do not imply equal request sizes, much less equal billed token counts.

Owner-only aggregate measurements and scenario calculations are saved locally under ignored `codex-tmp/pm-cost-feasibility/`. Normal tests reproduce the request construction using fixed synthetic data. They never depend on those ignored artifacts or live model responses.

## Why alternate spend controls were not enabled

OpenRouter exposes `stop_server_tools_when`, including a `max_cost` condition. It overrides `max_tool_calls`; when it fires during tool emission, pending tools execute and a final model turn still runs. A threshold is therefore not documented as an all-inclusive invoice ceiling, and unknown overshoot cannot be treated as zero. Neither its exact cost coverage nor a sufficient final-turn reservation was established here. The strict transport continues to reject this unapproved request field. [Chat Completions stop conditions](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).

The server-tools overview describes an outer loop bounded by tool steps and a final answer when the step budget is exhausted. It does not supply exact tokenization or a maximum byte size for all hidden messages. Keeping the existing full-context model-pass reservations is conservative; this investigation does not claim a tighter documented hidden-turn accounting rule. [Server-tool limits](https://openrouter.ai/docs/guides/features/server-tools#tool-call-limits).

Per-key limits and the gateway's in-flight credit reservation are separate access controls. The latter is based on balance and estimated token costs, excludes non-token fees, and applies only to some accounts. It is not an application-selected $0.15 whole-attempt reservation. No account/key limit was changed, and no retry recommendation from gateway documentation changes the application's no-retry policy. [OpenRouter credit limits](https://openrouter.ai/docs/api_reference/limits#in-flight-spending-budget).

## Options requiring a separate decision

1. **Retain the strict policy.** Keep refusing this hosted attempt while seeking a documented bound that covers complete gateway inputs, all turns and fees. An exact initial-request count alone is insufficient.
2. **Approve a monitored one-shot pilot policy instead of an absolute ceiling.** Define the target, acceptable overrun exposure, permitted calls and stop behavior explicitly. Do not relabel likely low historical cost as a guarantee. This is the smallest product-validation change, but needs human approval and is not implemented here.
3. **Redesign discovery around application-controlled search.** Fetch a bounded result set outside the hosted model loop, then use tool-free extraction and bounded repair. This could expose more of the cost surface, but needs a separately scoped search integration, verified tariffs, complete token/framing bounds and live usefulness evaluation. It is not a free swap or permission to add a new search key/provider.

The recommendation is to make that policy decision before another general hardening pass. The missing product result remains one genuinely useful, manually verified PM event and attendance feedback; this investigation does not validate discovery quality, ranking calibration or publication.

## Verification scope

New offline checks exercise real three-page request construction, Unicode/JSON escaping, repeated schema accounting, rejection of an unapproved spend-stop field, and refusal to disguise the research reservation by shrinking other phases. Verification passed formatting, lint, type checking, all 290 normal offline tests (6 unit, 249 ingestion, 22 dashboard, 13 review), a production build, 3 compiled-page checks, 13 runtime checks, and `git diff --check`. Build/page verification used a fresh credential-free copy with isolated storage under ignored `codex-tmp/`. Private verification logs accompany the local measurements. Optional live gateway, PostgreSQL and real-database integration were not exercised. No production calculation was reduced and no paid acceptance was run.
