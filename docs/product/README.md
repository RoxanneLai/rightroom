# Product planning

RightRoom helps NYC job seekers choose relevant in-person professional events. This folder explains the user problem, current system design and proposed path to a hosted career-discovery pilot.

## Documents

| Document                                                 | Purpose                                                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [Product requirements](PRD.md)                           | Primary, GitHub-readable requirements document with current-state evidence, proposed scope, roadmap, acceptance criteria and pilot measures. |
| [Word PRD](RightRoom-PRD.docx)                           | Downloadable nine-page planning edition for sharing and review.                                                                              |
| [Product strategy deck](RightRoom-Product-Strategy.pptx) | Downloadable 14-slide PM overview of users, decisions, design, evidence, risks and priorities.                                               |

## Status and implementation reference

These are **working product plans**, not approval to implement the roadmap, spend on API calls, publish events or deploy the service. Proposed metrics are hypotheses, not measured results. The screenshot in the deck shows fictional sample events.

The October 13, 2026 planning edition describes [revision d1e0946](https://github.com/RoxanneLai/rightroom/tree/d1e0946). Its 308-test figure refers to the documented October 9 verification checkpoint, not a new test run or a live quality result.

The repository has advanced since that snapshot. For current behavior and verification, consult the [main README](../../README.md), [career discovery guide](../CAREER-EVENTS.md), [attendance shortlist guide](../ATTENDANCE-SHORTLIST.md) and [PM discovery preparation](../PM-DISCOVERY-PREPARATION.md). In particular, the current guarded PM runner also refuses paid execution when the search tariff is unverified; the original planning exports discuss the cost-bound decision at their reference revision.

The first proposed release is a hosted NYC pilot for PM and technical-PM career entrants. Wider roles, cities, accounts and reminders are later options, subject to user evidence and separate prioritization.

## Updating the plans

- Update `PRD.md` first when requirements or decisions change. Record the planning date, implementation reference and whether a proposal has been approved.
- The Word document and deck are frozen sharing snapshots. Regenerate and review them when a new planning edition is ready; do not assume that a Markdown edit updates the binary files.
- Keep current implementation evidence separate from proposed requirements and dated pilot results.
- Keep credentials, databases, raw provider captures, private review packs, document builders and rendered verification files out of this folder. Temporary artifacts remain in ignored `codex-tmp/`.

The initial files were rendered and visually reviewed. They were not opened in desktop Word or PowerPoint.
