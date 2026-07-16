# Decisions & Trade-offs (ADR-lite)

Running log of the decisions that shaped this build. Each entry: context → options → decision → why → what we gave up.

---

### D1 — Feed transport: standalone Node WebSocket server

- **Context**: The brief hands us a static CSV and asks us to design the live feed, transport,
  and tooling ourselves — "be ready to defend it."
- **Options**: (a) standalone WS server; (b) in-browser Web Worker generator; (c) SSE.
- **Decision**: Standalone Node `ws` server (`server/`).
- **Why**: Closest to a real production feed — a genuine network boundary lets us reason about
  transport, batching, and reconnection, and it makes the "10× rows / multiple boards / offline
  depots" scaling discussion concrete. A local Node process is **not** an "external service"
  (that means Redis / cloud brokers), so the single-command + no-external-services rule holds.
- **Gave up**: The absolute simplicity of an in-process generator; we now manage a second
  process (handled by `concurrently`).

### D2 — State management: Zustand with per-row selectors + structural sharing

- **Context**: 10k rows, hundreds of updates/sec. The failure mode (from research) is a naive
  store re-rendering the whole list on every update.
- **Options**: (a) custom external store + `useSyncExternalStore`; (b) Zustand; (c) Valtio;
  (d) Jotai.
- **Decision**: Zustand, with each row subscribing via a selector to **its own** entry, and the
  flush producing a new map that reuses unchanged row references (structural sharing).
- **Why**: Mature, minimal API; internally already built on `useSyncExternalStore`. Structural
  sharing means an unchanged row's selector returns the same reference (`Object.is`) → no
  re-render; only changed rows re-render. This neutralizes the "whole-list re-render" trap.
- **Gave up**: The teaching-value of hand-rolling the store primitive; Valtio's automatic
  proxy tracking (harder to defend at 10k) and Jotai's atom-per-row (heavier here).

### D3 — Virtualization: TanStack Virtual

- **Options**: (a) TanStack Virtual; (b) react-window; (c) react-virtuoso.
- **Decision**: TanStack Virtual.
- **Why**: Actively maintained (2026), headless/full control, pairs well with a custom row
  renderer and the perf story. At 10k rows all three hit 60fps; the bottleneck is the row
  renderer, not the library — so we optimize the renderer.
- **Gave up**: react-window's smaller API surface (but it's unmaintained and fixed-size only).

### D4 — Project structure: single package, folders `web/ server/ shared/`, npm only

- **Context**: The brief weights "the demo runs with the documented command" above every
  individual feature — if it doesn't run, the application can't progress.
- **Options**: (a) pnpm/turbo monorepo; (b) npm workspaces; (c) single package + folders.
- **Decision**: Single `package.json`, source split into folders, plain npm, `concurrently`
  for one command. A committed `package-lock.json` pins the exact dependency tree.
- **Why**: Requires only Node — one `npm install`, one `npm run dev`, zero extra toolchain
  steps (no `corepack enable`). Fewest failure points for a reviewer running it cold. Module
  boundaries are still clear via folders + the `shared/` contract.
- **Gave up**: Per-package dependency isolation and cache granularity of a real monorepo —
  noted as a "next step" for team scale in ARCHITECTURE.md.
- **When I'd reach for a real monorepo** (the honest boundary, not "monorepo bad"): the
  moment there are *independent consumers* of shared code — e.g. the "multiple boards" scale
  scenario, where several frontend apps share a `@tv/ui` component library and a `@tv/protocol`
  package. Then pnpm workspaces + Turborepo build caching earn their keep. At 3 folders, one
  runnable app, and zero published packages, they don't. Right tool, right scale.

### D5 — Update batching: ref buffer + requestAnimationFrame flush

- **Context**: Hundreds of deltas/sec must not translate into hundreds of React renders/sec.
- **Decision**: Buffer incoming deltas in a ref; flush once per animation frame, coalescing
  multiple updates to the same reference to the latest, skipping no-op value changes.
- **Why**: Collapses any arrival rate into at most one commit per frame (~16.7ms), aligned to
  the browser paint cycle; rAF also auto-throttles in background tabs.
- **Gave up**: Slightly more update latency (≤1 frame) vs. synchronous updates — imperceptible,
  and the correct trade for smoothness.

### D6 — Feed generator: authoritative server state, per-tick batched deltas, lifecycle transitions

- **Context**: The feed must push "a few hundred updates/sec at peak, rate configurable" and be
  defensible.
- **Decisions**:
  1. The server holds the single authoritative state (`Map<ref, Shipment>`); clients get a
     snapshot of *current* state on connect, so multiple clients/reconnects stay consistent.
  2. The generator wakes every 50ms and emits `rate × 0.05` updates as **one batched delta**,
     rather than one WS frame per update — far fewer frames, same throughput.
  3. Updates follow a realistic lifecycle (`created → picked_up → in_transit →
     delivered/failed → recycle`) instead of pure noise, so every update is a real change and
     the board churns like a real ops board.
- **Why**: Server-authoritative state is the honest model and makes the "multiple boards /
  reconnect / offline" scaling story concrete. Batching decouples throughput from frame count.
  Lifecycle churn keeps highlight + filter-membership logic genuinely exercised in the demo.
- **Gave up**: Per-client independent feeds (all clients share one global rate — noted as a
  next step); a heavier streaming CSV parser (unneeded for the clean, flat dataset).
- **Verified**: `FEED_RATE=300` → measured ~295 updates/sec; snapshot = 10,000 rows.

### D7 — Change highlight: rev-keyed fade overlay with a mount guard

- **Context**: "rows update in place with a brief visual highlight on change" — but
  it must flash *only* on in-place change, not on load or when a row scrolls into view.
- **Decision**: Each row carries a `rev` counter (bumped per update). The row renders a
  `<span key={rev}>` overlay that plays a one-shot CSS fade; changing `key` replays it. A
  mount guard (`mounted` ref + `rev > 0`) suppresses the flash on first mount, so neither the
  initial 10k load nor scroll-in triggers a flash.
- **Why**: Declarative and cheap (only visible, actually-changed rows remount a tiny span);
  the fade is pure CSS (compositor), and `prefers-reduced-motion` disables it.
- **Gave up**: A JS-driven animation-restart (reflow hack) — more forced layouts per frame.
- **Verified (M4, CDP + injected FPS meter)**: at **800 updates/sec**, sustained 120fps
  (120Hz display) both idle and during continuous scroll; `Applied/s` tracked the feed with a
  stable buffer (no backpressure); slider drives the server rate end-to-end (200 → 1200).

### D8 — Filtering under churn: recompute only what churn can change

- **Context**: filter-by-status + text-search must stay correct AND responsive while the data
  churns underneath.
- **Key insight**: deltas change `status` and `last_update`, but never `reference`/`customer`.
  So **search** membership is invariant under churn (its keys never change); only **status
  filter** membership can change as rows transition. This narrows the hard case precisely.
- **Decisions**:
  - `filteredOrder` is a derived view the table renders. It's recomputed on user actions
    (toggle status / type search), and on each delta flush **only if a status filter is active**.
    Pure-search or unfiltered views are never recomputed on churn.
  - Search is debounced (150ms) → no full scan per keystroke.
  - Each row precomputes a lowercase `searchKey` once at load → allocation-free substring match.
  - The live result count is isolated into its own component, so churn re-renders the count, not
    the search input or the chips.
- **Why**: correctness is guaranteed (the active-filter path recomputes membership every flush),
  while wasted work is eliminated (the common cases don't recompute). A full 10k scan is
  sub-millisecond and only runs when it can actually matter.
- **Verified (M5, CDP under churn)**: search / status / combined all correct; with a status
  filter active at **~2000 updates/sec**, 10 rounds of scroll-under-churn showed **0** rows
  violating the filter, at a sustained 120fps.

### D9 — Testing scope: the tricky parts, deliberately not broad UI coverage

- **Context**: the brief asks for "tests for the genuinely tricky parts — e.g., update batching
  or filtering under churn" and explicitly says "no need for broad UI snapshot coverage."
- **Decision**: 26 focused unit tests on pure logic, no UI component/snapshot tests:
  - client: `DeltaBatcher` (rAF batching/coalescing), `boardStore` (structural sharing,
    coalescing, filtering, filtering-under-churn);
  - server: `FeedEngine` (rate→count math, lifecycle no-op-free guarantee, clamp, start/stop),
    `parseShipments` (guards for malformed/unknown-status rows, CRLF).
- **Why**: this matches the brief's intent and the timebox. Broad UI coverage would contradict
  the brief, add little (the virtualizer is the library's job — verified via a CDP integration
  harness instead), and read as gold-plating. To keep the batcher and CSV parser unit-testable,
  their logic was extracted from side-effecting shells (`requestAnimationFrame` / `fs`) behind an
  injectable scheduler and a pure `parseShipments(text)` — a testability-driven refactor.
- **What I'd add next**: a Playwright smoke test asserting FPS-under-load and filter-under-churn
  in a real browser (the CDP harness already proves this; Playwright would make it CI-runnable).
