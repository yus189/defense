# AI Usage Note

TransVirtual is AI-first, and this assignment was built AI-first — with the engineer driving
the decisions. This note is updated as the build progresses.

## Tools

- **Claude Code (Opus)** — primary agent: planning, research, scaffolding, implementation,
  and test authoring, under step-by-step review with acceptance gates.

### Project-level skills (and the judgment about which to use)

Skills installed under `.claude/skills/` and how each was applied — including one deliberately
*not* used, because knowing when a tool doesn't fit is part of using tools well:

| Skill | Used? | Where |
|---|---|---|
| `vercel-react-best-practices` | Yes | Render-perf decisions in the table/store/filters (ref-for-transient-values, per-row memo, Map lookups, deferred value for search). |
| `frontend-design` | Yes | Visual identity of the ops board — status color system, tabular type, the perf-HUD signature element; motion kept minimal on purpose. |
| `code-review` | Yes | Final self-review pass before delivery. |
| `monorepo-management` | Reference only | Informs the "when to adopt a monorepo" section of ARCHITECTURE.md; not used to build (single package is deliberate — see DECISIONS D4). |
| `find-skills` | On demand | Discovering skills for needs not otherwise covered. |
| `unit-tests` | **Removed** | Was scoped to the VS Code repo specifically (`scripts/test.sh`, `runTests`) — irrelevant to our Vitest setup, so it was deleted rather than left to mislead. Knowing when a tool doesn't fit is part of using tools well. |

## Method

- Every milestone has an explicit acceptance gate; nothing advanced without a verified result.
- Each significant technical choice was researched (2026 best-practice) and recorded in
  [DECISIONS.md](./DECISIONS.md) with the trade-off, so every decision is defensible.

## Things the AI got wrong, and how I caught them

**The rate slider didn't actually drive the feed.** The automated numbers all passed — 120fps,
`Applied/s = 800` — but a screenshot showed the slider reading "200/s" while the feed ran at 800:
the AI had wired the slider as a cosmetic control, not the source of truth. Assertions couldn't
catch it (slider and feed were each internally consistent, they just disagreed); a visual review
did. Fix: the client now asserts the slider's rate to the server on connect and on every change, so
the two can't drift.

**The change-highlight flashed when it shouldn't.** The first version remounted the highlight
overlay keyed by `rev`, which fires on every mount — so every row flashed on initial load and again
whenever it scrolled into view. I caught it by reasoning through mount-vs-in-place-change semantics
before running, and added a mount guard so only genuine in-place updates flash. A reviewer later
found a related case — a filtered list reshuffling a row slot flashed the *wrong* shipment — fixed
by keying the virtualizer on `reference` instead of index.

## Pre-delivery review (multi-agent)

Before packaging, I ran a review pass using three parallel review subagents (correctness/bugs,
React render performance, clarity/robustness), then triaged their findings. High-value, low-risk
items were fixed and re-verified; edge cases were recorded as "what I'd do next". Notable fixes:

- **WebSocket auto-reconnect with backoff** — the client previously froze on `disconnected`
  forever; now it recovers from the startup race and server restarts (verified: kill feed →
  `disconnected` → restart → auto-reconnect → data resumes).
- **`getItemKey` by reference on the virtualizer** — fixed a spurious highlight when a filtered
  list reshuffles a row slot, and kept `React.memo` effective under filtered churn.
- **Server crash guards** — a `null` client message no longer crashes the feed; empty-dataset and
  missing-CSV paths are handled; `SIGINT` shutdown no longer hangs on live sockets.
- **Portability** — replaced `import.meta.dirname` (Node ≥20.11) with `fileURLToPath`; removed two
  unused devDependencies; relabeled the misleading "Buffer" HUD stat to "Batch".

## Generated vs. hand-written / directed

- **AI-generated, engineer-reviewed**: scaffolding, the feed engine, store, virtualized table,
  HUD, and CSS were AI-drafted, then reviewed and corrected line-by-line (the three catches
  above came out of that review).
- **Engineer-directed**: the architecture and every technology choice (transport, state
  management, virtualization, batching, single-package layout) were decided deliberately with
  documented trade-offs (DECISIONS.md), and each milestone was verified against an acceptance
  gate before moving on.
