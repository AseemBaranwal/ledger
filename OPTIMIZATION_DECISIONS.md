# Performance & Efficiency Audit — Decision Log

**Branch:** `optimization/performance-efficiency` (not merged — review and merge manually)
**Scope:** Full audit of `src/`, `api/`, `supabase/`, `tests/`, and build config against five
dimensions: API efficiency, latency, storage, usability, and code health. This document
records every change that was made, why, what else was considered, and what was
deliberately left alone.

Every change below was verified against the live codebase (not just read in isolation) —
`npm run build`, `npx vitest run` (272 tests), and an `api/**/*.ts` typecheck all pass
after every commit. Two changes (the CoachTab bundle-split fix and the sheets-sync
checkpoint fix) are genuine correctness bugs caught mid-audit, not just efficiency
tuning — called out explicitly below since they're the highest-value findings.

This is a solo-user personal app (per `README.md`/`CLAUDE.md`) — every decision below was
made with that scale in mind. Findings that only matter at real multi-user scale (e.g.
theoretical row-count concerns) were deliberately not chased; see "Considered but not
done" at the end for what was triaged out and why.

---

## 1. Backend (`api/`)

### 1.1 Parallelize `getTrainingData`'s two independent Supabase reads

- **Problem:** `api/_lib/chatTools.ts`'s `getTrainingData` — called on essentially every
  Coach chat turn — awaited the `profiles` fetch (for substitutions/program names) and the
  `sessions` fetch sequentially, even though neither depends on the other's result.
- **Options considered:**
  (a) Leave sequential — simplest, but pays a full extra Supabase round-trip on the hottest
  path in the Coach feature. (b) `Promise.all` the two queries. (c) Merge into a single
  Postgres RPC/join — fastest in theory, but this app has no generated DB types and no
  existing RPC-function pattern; introducing one for a single call site is disproportionate.
- **Choice:** (b) `Promise.all`. Minimal, mechanical, no new infrastructure.
- **Implementation:** `api/_lib/chatTools.ts` — build the sessions query object first
  (doesn't need profile data), then `Promise.all([profileQuery, sessionsQuery])`.
- **Trade-offs:** None meaningful — same two round-trips happen, just concurrently instead
  of serially.
- **Risk:** Low. Both queries were already independent; no shared mutable state.
- **Testing:** Existing `tests/unit/chatTools.test.ts` (24 tests) exercises `getTrainingData`
  end-to-end against a mocked `supabaseAdmin`, including the error-surfacing path — all still
  pass unchanged, confirming behavior is identical, just concurrent.

### 1.2 Parallelize the chat handler's post-turn writes

- **Problem:** `api/chat/message.ts` awaited `logChatCall` (writes `chat_logs`) and then
  `saveChatTurn` (writes `chat_messages`) sequentially after every reply, adding tail latency
  to every single message the user sees returned.
- **Options considered:** (a) Leave sequential. (b) `Promise.all` both writes, since neither
  reads the other's result and both are already "best-effort, swallow errors" by design.
  (c) Move one of them to a genuine fire-and-forget (`void writeCall()`) with no await at
  all — rejected because Vercel Edge Functions can terminate the function once the response
  stream closes, and `streamController.close()` happens right after this block; an un-awaited
  write could be killed mid-flight.
- **Choice:** (b) `Promise.all`. `fetchDailyTokenTotals` still runs afterward since it
  genuinely depends on `logChatCall` having written its row first.
- **Implementation:** `api/chat/message.ts` — `const [, savedIds] = await Promise.all([logChatCall(...), callError ? Promise.resolve(null) : saveChatTurn(...)])`.
- **Trade-offs:** None — both writes still happen, still best-effort, just concurrently.
- **Risk:** Low.
- **Testing:** Covered by the full suite passing; this endpoint has no dedicated handler-level
  test (see "Testing gaps" below) but the logic change is a pure reordering with identical
  inputs/outputs per branch.

### 1.3 Cap inbound chat history size server-side

- **Problem:** Only the last message's character length was validated
  (`MAX_MESSAGE_CHARS`); the full `messages` array the client sends was forwarded to
  Anthropic with no size limit. The client already slices to the last 24
  (`MAX_MESSAGES_SENT` in `chatStore.ts`), but nothing enforced that server-side.
- **Options considered:** (a) Trust the client entirely (status quo). (b) Add a server-side
  cap on array length, set comfortably above the client's normal 24. (c) Cap total
  serialized byte size instead of message count — more precise but unnecessary complexity
  for a single-owner endpoint already gated by `CHAT_OWNER_USER_ID`.
- **Choice:** (b). Owner-only endpoint, so this is a defense-in-depth/cost-control measure
  more than a security boundary, but cheap and removes a "what if the client has a bug"
  failure mode.
- **Implementation:** `api/chat/message.ts` — `MAX_INBOUND_MESSAGES = 40`, checked right
  after the empty-array check, before the message is otherwise processed.
- **Trade-offs:** None for legitimate traffic (40 ≫ 24).
- **Risk:** Low.
- **Testing:** Manual reasoning check only (no existing handler-test harness); the check is
  a single early-return guard, low complexity.

### 1.4 Skip the wasted pre-check sleep in Strava upload polling

- **Problem:** `pollUploadUntilDone` in `api/strava/post-activity.ts` slept 1s **before**
  every poll attempt, including the first, even though Strava's own docs put mean
  processing time under 2s — the common case (already done) paid a flat ~1s tax on every
  single logged workout's post-to-Strava latency for no reason.
- **Options considered:** (a) Leave as-is. (b) Only sleep between attempts, not before the
  first. (c) Reduce the sleep interval — rejected, since it doesn't address the wasted
  first sleep and would increase Strava API call volume for the same 15s budget.
- **Choice:** (b).
- **Implementation:** `api/strava/post-activity.ts` — `if (attempt > 1) await sleep(1000)`.
- **Trade-offs:** Slightly less total wall-clock coverage (14s of sleep across 15 attempts
  instead of 15s) — negligible against Strava's own <2s mean.
- **Risk:** Low — purely a timing change, no logic change.
- **Testing:** No existing test for this file; verified by reading the change against
  Strava's documented processing time and the existing attempt-budget math.

### 1.5 Persist sheet-sync checkpoint after every row, not just at the end — **correctness fix**

- **Problem:** `api/sheets/sync.ts` tracked `maxCreatedAt` in a local variable across its
  export loop and only wrote `profiles.sheet_sync_checkpoint` once, after the whole batch
  finished. If the function timed out or threw partway through a backlog (e.g. a first-ever
  sync of months of history), every row already POSTed successfully in that run had its
  progress unrecorded — the next sync attempt re-POSTed and **duplicated** them in the
  Sheet. Worse: a backlog that reliably exceeded the function's time budget could never
  finish syncing, since it always restarted from the same point.
- **Options considered:** (a) Leave as-is (accept occasional duplicate rows on
  timeout/crash). (b) Persist the checkpoint after every successful row. (c) Batch the
  checkpoint write every N rows — balances round-trip cost against durability, but adds
  complexity (tracking "since last write") for a sync that only runs a handful of times a
  week, per session, against a small backlog.
- **Choice:** (b). At this app's real volume (this is a manual, low-frequency,
  power-user-only sync per `CLAUDE.md`), one extra write per exported row costs
  essentially nothing against eliminating a real data-duplication bug.
- **Implementation:** `api/sheets/sync.ts` — moved the `profiles` update inside the loop,
  right after each successful POST, keyed off that row's own `created_at`.
- **Trade-offs:** More Supabase writes per sync call (bounded by backlog size, which is
  small in practice). No behavior change for the common case (small backlog, no
  timeout) — only the failure/partial-completion case changes, and only for the better.
- **Risk:** Medium in principle (touches a write path), low in practice — the change is
  additive (write happens more often, same value, same condition-gated skip on failure)
  and doesn't alter what counts as success/failure.
- **Testing:** No existing test file for this handler (see "Testing gaps"). Verified by
  reading the change against the original bug scenario: a mid-loop throw now leaves the
  checkpoint at the last *successful* row instead of the pre-run value.

---

## 2. Database (`supabase/`)

Both migrations below are **new files, not applied to the live database** — consistent with
this repo's existing pattern (every `supabase/*.sql` file is meant to be reviewed and run
manually via the Supabase CLI or SQL editor, never executed automatically by app code or
CI). They're included in this branch for review, not auto-applied.

### 2.1 Wrap `auth.uid()` in RLS policies as a scalar subquery

- **Problem:** Every existing RLS policy (`sessions`, `profiles`, `strava_connections`,
  `chat_logs`, `chat_messages`) compares a column to the bare `auth.uid()` call. Postgres
  can only cache a function call as a per-query InitPlan (evaluated once) when it's wrapped
  as a scalar subquery — the bare form re-evaluates on every row the planner considers,
  defeating index-only evaluation. This is Postgres/Supabase's documented
  `auth_rls_initplan` pattern, and it applies to tables hit on nearly every authenticated
  request (`sessions` on every page load, `profiles` on every substitution read/write).
- **Options considered:** (a) Leave as-is — works correctly, just re-evaluates
  `auth.uid()` per row. (b) Rewrite every policy to `(select auth.uid()) = user_id`. (c)
  Switch to a `security definer` function wrapper — more machinery for the same effect.
- **Choice:** (b) — the documented, minimal fix with zero semantic change.
- **Implementation:** New file `supabase/rls_auth_uid_initplan_fix.sql` — drops and
  recreates every existing policy with the wrapped form. Idempotent (`drop policy if
  exists` + `create policy`), safe to re-run.
- **Trade-offs:** None — purely a query-plan improvement, identical access control.
- **Risk:** Low for the SQL itself (mechanical rewrite). Not yet applied to the live
  database — applying any RLS change to a production auth boundary deserves a human's
  own review before running, so this ships as a reviewable migration file, not an
  auto-applied one.
- **Testing:** SQL correctness reviewed by hand against Supabase's own documented pattern
  for this exact issue. Recommended verification once applied: re-run the existing "an
  authenticated request with no filter only returns the caller's own row" check described
  in `README.md`'s data-isolation section, to confirm access control is unchanged.

### 2.2 Add indexes matching real query patterns + a data-integrity guard

- **Problem:** `sessions` only indexes `(user_id, d)`, but the two real callers that
  matter — the Coach's `get_training_data` and the Sheet-sync endpoint — both additionally
  filter `type = 'PROGRAM'`, and the sync endpoint orders by `created_at`, which had no
  index at all (forcing an explicit sort on every sync). Separately, `client_errors.user_id`
  is a foreign key with no index at all, and `sessions.type` has no constraint even though
  every code path only ever writes `'PROGRAM'` or `'REST'`.
- **Options considered:** (a) Leave as-is — fine at today's row counts, but "fine for now"
  isn't the same as "correctly indexed," and this app is meant to accumulate years of
  training history for its owner. (b) Add full-table indexes matching each pattern. (c) Add
  **partial** indexes scoped to `type = 'PROGRAM'` — smaller and a closer match to how the
  columns are actually queried, since every real caller already filters on that column.
- **Choice:** (c) for the sessions indexes (smaller, tighter match); a plain index for
  `client_errors.user_id` (not filtered by anything else); a `not valid` check constraint
  for `sessions.type` so it enforces new writes without needing to scan/lock existing rows.
- **Implementation:** New file `supabase/perf_indexes.sql` — two partial indexes on
  `sessions`, one plain index on `client_errors`, one `not valid` check constraint. All
  `if not exists`/idempotent.
- **Trade-offs:** Small write-amplification cost (every insert/update maintains one more
  index) — negligible at this app's real write volume (a handful of session inserts per
  week per user). The check constraint's `not valid` clause means it *won't* retroactively
  validate any already-bad existing rows — the migration comment tells the reviewer to
  check `select distinct type from sessions` first if this has ever run against a
  populated table.
- **Risk:** Low. Not applied automatically, same reasoning as 2.1.
- **Testing:** Query shapes cross-checked directly against the real caller code
  (`api/_lib/chatTools.ts`, `api/sheets/sync.ts`) rather than assumed from the schema
  alone.

### 2.3 Considered, not implemented: atomic jsonb updates for profile writes

- **Problem found:** `profiles.routine_config` and `profiles.exercise_substitutions` are
  both written via a read-modify-write pattern (select the whole jsonb blob, mutate it in
  JS, write the whole blob back) in multiple places (`api/chat/apply-exercise-change.ts`,
  `api/chat/apply-exercise-swap.ts`, `src/services/exerciseSubstitutionsApi.ts`). Two
  concurrent writers (e.g. phone + laptop open at once) could race and one write could
  silently clobber the other.
- **Why not fixed here:** The real fix — a Postgres function doing an atomic
  `jsonb_set`/`||` merge, called via an RPC instead of select-then-update — is a genuine
  architecture change (new DB function, new call sites, no existing RPC pattern in this
  codebase to follow) rather than a contained optimization. Given this app is explicitly
  single-owner (`CHAT_OWNER_USER_ID` gates the write endpoints; the RLS-direct writes are
  scoped to `auth.uid()` = one person's own data), the realistic exposure is "the same
  person has two tabs open and edits the same field within the same second" — a real but
  low-probability, low-consequence scenario (worst case: one of two nearly-simultaneous
  edits doesn't stick, and the last write silently wins with no data corruption). Flagging
  this in the decision log rather than shipping a bigger structural change under time
  pressure, per this audit's own guidance to weigh impact against risk.

---

## 3. Frontend (`src/`)

### 3.1 Fix: CoachTab's lazy-loading was silently defeated — **bundle-size correctness bug**

- **Problem found while verifying the build (not in the original audit sweep):**
  `App.tsx` lazy-loads `CoachTab` specifically so `react-markdown` (used only there, ~35KB
  gzipped) ships in its own chunk instead of the main bundle every visitor downloads —
  documented explicitly in both `App.tsx`'s own comment and `vite.config.ts`'s
  `globIgnores` for the PWA precache. But `src/components/tabs/index.ts` also did
  `export { CoachTab } from './CoachTab'` as a **static** re-export. Because `App.tsx`
  statically imports the other four tabs from that same barrel file, Rollup pulled
  `CoachTab`'s entire module graph into the same chunk as the barrel — the separate dynamic
  `import()` never actually split anything out. Confirmed directly: `npm run build` before
  this fix produced no `CoachTab-*.js` chunk at all, and Rollup printed an explicit warning
  (`dynamically imported ... but also statically imported ... will not move module into
  another chunk`).
- **Options considered:** (a) Leave it — the intended optimization silently doesn't work.
  (b) Remove the barrel re-export, since nothing actually needs it (`App.tsx` already
  imports `CoachTab` via its own direct dynamic import; the one test file that renders it
  imports it directly too). (c) Keep the barrel export but change `App.tsx`'s lazy import to
  go through the barrel too — rejected, since that's the exact static/dynamic combination
  causing the problem in the first place.
- **Choice:** (b) — delete the dead re-export, document why it's deliberately absent so a
  future contributor doesn't "helpfully" re-add it.
- **Implementation:** `src/components/tabs/index.ts`.
- **Trade-offs:** None — nothing in the codebase used the barrel export.
- **Risk:** Low, verified directly.
- **Testing:** `npm run build` before/after, byte-for-byte comparison of the emitted chunk
  list:

  | | Before | After |
  |---|---|---|
  | Main chunk | 234.33 kB (71.70 kB gzip) | 107.87 kB (34.20 kB gzip) |
  | CoachTab chunk | *(did not exist — bundled into main)* | 126.22 kB (37.60 kB gzip), split out |
  | PWA precache total | 610.46 KiB | 486.94 KiB |

  Every visitor who isn't the Coach-tab owner (i.e. almost everyone, since it's gated by
  `VITE_CHAT_OWNER_EMAIL`) now downloads roughly a third less JavaScript on first load. Full
  test suite (272 tests) still passes.

### 3.2 Memoize `ExerciseLogger` so unrelated set/weight edits stop re-rendering every card

- **Problem:** `TodayTab` re-renders on every rep logged, weight bumped, or notes
  keystroke during an active session (`draftEx`/`draft` replace by reference on every
  change). `ExerciseLogger` wasn't memoized, so **every other mounted exercise card**
  re-rendered too on each of those — not just the one that actually changed — each
  re-render redoing a full session-history scan via `lastOf()`. This is the app's core,
  highest-frequency screen per its own stated purpose ("record a set in under three
  seconds, one-handed, in a gym" — `README.md`).
- **Options considered:** (a) Leave as-is — the existing narrow `draftEx?.[index]`
  selector inside `ExerciseLogger` avoids one layer of re-render, but not the one caused by
  the *parent* re-rendering for an unrelated reason. (b) Wrap `ExerciseLogger` in
  `React.memo`, and stabilize its two callback props (`onRequestSwap`/`onRequestRemove`) in
  `TodayTab` with `useCallback` so the memo isn't immediately defeated by fresh inline
  arrows every render. (c) Restructure state to avoid the parent-level re-render
  entirely (e.g. move `draftEx` into per-card local subscriptions) — a much larger state
  redesign for the same practical effect as (b), rejected as disproportionate.
- **Choice:** (b).
- **Implementation:** `src/components/session/ExerciseLogger.tsx` (wrap export in
  `memo(...)`), `src/components/tabs/TodayTab.tsx` (`useCallback` for the two handlers,
  passed to `ExerciseLogger` instead of inline arrows).
- **Trade-offs:** None functionally — `def`/`index` were already referentially stable
  across unrelated re-renders (they only change on an actual swap/add/remove), so the
  shallow-prop memo is a clean win with no risk of stale-prop bugs.
- **Risk:** Medium in principle (memoization bugs can cause silently-stale UI), mitigated
  by verifying `def`/`index`'s stability came from existing, already-tested state-update
  logic in `sessionStore.ts` rather than something newly introduced.
- **Testing:** Full suite (272 tests, including `ExerciseLogger.test.tsx`'s 11 tests) passes
  unchanged.

### 3.3 Replace full-history flatMap scan with `lastOf()` in the week-card preview

- **Problem:** The expanded "this week" day preview in `TodayTab.tsx` rebuilt a flattened
  array of every exercise across the **entire** session history, on every render the
  preview was visible, just to find one exercise's last logged set.
- **Options considered:** (a) Leave as-is. (b) Memoize the flatMap with `useMemo`. (c)
  Replace it with the existing, already-tested `lastOf()` helper from
  `trendCalculations.ts` — which does the identical lookup (last session with a logged set
  for this code) in a single backward pass with an early exit per session, no full-history
  array ever materialized, and is already used by `ExerciseLogger` for the same purpose.
- **Choice:** (c) — strictly better than (b) (no array allocation at all, not just a
  cached one) and removes duplicated logic instead of adding a new memo to maintain.
- **Implementation:** `src/components/tabs/TodayTab.tsx` — one-line swap.
- **Trade-offs:** None — identical semantics, verified by reading both implementations
  side by side (same "most recent session with `r.length`" definition).
- **Risk:** Low.
- **Testing:** Full suite passes; `lastOf()` itself already has coverage via its other call
  sites' tests.

### 3.4 Memoize History tab's week grouping

- **Problem:** `HistoryTab.tsx` grouped the full session history into weeks
  (`byWeek`) on every render, including ones triggered by unrelated state (toggling a row
  open/closed, switching lb↔kg) that don't change the grouping itself.
- **Options considered:** (a) Leave as-is — cheap at today's data volumes, but grows
  with the app's whole point (accumulating years of training history). (b) `useMemo` keyed
  on `sessions`.
- **Choice:** (b).
- **Implementation:** `src/components/tabs/HistoryTab.tsx` — moved the computation into a
  `useMemo` before the component's early return (required by the Rules of Hooks, since
  hooks can't be called conditionally).
- **Trade-offs:** None.
- **Risk:** Low.
- **Testing:** Full suite + `HistoryTab.test.tsx`'s 3 tests pass unchanged.

### 3.5 Memoize Trends tab's weekly-consistency and volume-by-group data

- **Problem:** `TrendsTab.tsx` recomputed its "weekly consistency" bar-chart data and
  "volume by muscle group" data on every render — including ones triggered by switching
  the group-filter tab or tapping a chart point, neither of which changes this
  session-history-derived data.
- **Options considered:** (a) Leave as-is. (b) `useMemo` the whole block, keyed on
  `[sessions, program]` (the only two things it actually depends on — not
  `selectedGroup`/`unitSystem`). (c) Split into two separate memos, one per concern — more
  granular but no real benefit here since both blocks share the same trigger (a
  `sessions`/`program` change) and recompute together anyway.
- **Choice:** (b).
- **Implementation:** `src/components/tabs/TrendsTab.tsx` — single `useMemo` returning
  `{ weeks, grp, gtot }`, placed before the component's early return.
- **Trade-offs:** None — `Date.now()`/`new Date()` are still called fresh, just once per
  `sessions`/`program` change instead of every render; the component fully remounts on tab
  switch anyway (see `App.tsx`'s conditional tab rendering), so this can't go meaningfully
  stale in practice.
- **Risk:** Low-medium (chart logic, verified carefully) — mitigated by keeping the
  refactor to a pure "move this block into `useMemo`" with no logic changes.
- **Testing:** Full suite passes; no dedicated `TrendsTab` test file exists in this repo
  (see "Testing gaps"), so this was verified by careful line-by-line comparison of the
  moved block against the original.

### 3.6 Extract Coach tab's message list into a memoized child component

- **Problem:** The chat composer's `input` state lived in the same component
  (`CoachTab`) as the entire message list, so every keystroke while typing a question
  re-rendered the whole conversation — including re-parsing markdown via `ReactMarkdown`
  for every past assistant message. This gets worse the longer a conversation runs, since
  chat history is durable (`chat_messages` table, `README.md`).
- **Options considered:** (a) Leave as-is — a real but bounded cost (chat history for a
  single owner, not unbounded users). (b) Extract the message list into a
  `React.memo`'d child component, stabilizing its callback props with `useCallback`/stable
  `useState` setters so the memo isn't defeated. (c) Move `input` into its own child
  component instead — equally effective for isolating the composer's re-renders from the
  list, but (b) was chosen since the list is the expensive side (markdown parsing), not the
  composer.
- **Choice:** (b).
- **Implementation:** `src/components/tabs/CoachTab.tsx` — new `MessageList` component
  (wrapped in `memo`), receiving `messages`/`sending`/etc. as props plus stabilized
  callbacks (`useCallback` for `toggleThinking`/`startLongPress`/`cancelLongPress`/
  `toggleSendingThinking`; the chat-store actions were already stable references; the
  `setRevealedId`/`setOpenThinkingIds` `useState` setters are stable by React's own
  guarantee).
- **Trade-offs:** Slightly more indirection (one more component, explicit prop list)
  versus the original single-component version — judged worth it given how directly this
  maps to a real, user-visible cost (typing latency scales with conversation length).
- **Risk:** Medium (largest single refactor in this audit — a UI extraction touching
  long-press/reveal/scroll interactions) — mitigated by keeping every piece of JSX and
  logic byte-identical, only moving *where* it lives, and running the full suite plus a
  manual read-through of every prop's origin for staleness risk before committing.
- **Testing:** Full suite (272 tests, including `CoachTab.test.tsx`'s 4 tests) passes
  unchanged. `npx tsc --noEmit` clean (catches prop-shape mismatches that a test might
  miss).

### 3.7 Show a neutral loading state while Strava connection status resolves

- **Problem:** `stravaStore.checkConnection` tracked a `checking` flag around its async
  lookup, but nothing read it. `SyncTab` always rendered the disconnected "Connect Strava"
  button first, then flipped to "Connected" once the check resolved — a visible flash of
  the wrong state, worse on a slow connection. The store's `checking` also *defaulted* to
  `false`, so even reading it wouldn't have fully closed the gap for the very first render.
- **Options considered:** (a) Leave as-is (cosmetic issue, arguably minor). (b) Read
  `checking` in `SyncTab` and show a neutral state, and change its default to `true` since
  `App.tsx` always calls `checkConnection()` right after sign-in. (c) Add a skeleton
  loader instead of a text line — more polish, judged unnecessary for a state that resolves
  in well under a second on any reasonable connection.
- **Choice:** (b).
- **Implementation:** `src/store/stravaStore.ts` (default `checking: true`),
  `src/components/tabs/SyncTab.tsx` (read `checking`, render "Checking connection…" first).
- **Trade-offs:** None.
- **Risk:** Low — `SyncTab` is only reachable after sign-in (gated by `App.tsx`), and
  `App.tsx`'s effect unconditionally calls `checkConnection` whenever a user is present, so
  `checking` can't get stuck `true` forever in practice.
- **Testing:** Full suite passes; no existing `SyncTab` test file (see "Testing gaps").

### 3.8 Defer backup blob URL revocation past the download click

- **Problem:** `SyncTab.tsx`'s local-backup download called
  `URL.revokeObjectURL(a.href)` on the very next line after `a.click()`, with no delay.
  Some browsers/PWA contexts (notably iOS Safari standalone) can race an immediate revoke
  against the download actually starting, producing an empty or failed file with no visible
  error — a silent data-export failure for a feature whose entire point is "have a safety
  copy of your data."
- **Options considered:** (a) Leave as-is. (b) `setTimeout(() => URL.revokeObjectURL(...), 0)`
  — defers the revoke to the next event-loop tick, after the browser has had a chance to
  start the download. (c) Never revoke at all — simplest, but leaks the blob URL for the
  page's lifetime; each backup is small (JSON of the session log) but this is still
  needless.
- **Choice:** (b).
- **Implementation:** `src/components/tabs/SyncTab.tsx`.
- **Trade-offs:** None meaningful — a near-zero-cost deferral.
- **Risk:** Low.
- **Testing:** Full suite passes. This specific race is timing/platform-dependent and not
  practically reproducible in `jsdom`, so it wasn't feasible to add an automated
  regression test — flagged honestly rather than claiming coverage that doesn't exist.

### 3.9 Considered, not implemented

- **`ExercisePicker.tsx`'s `recentlyUsed` scan** walks backward through `sessions` looking
  for 8 distinct exercise codes with no cap on how far back it looks. If a program has
  fewer than 8 total distinct exercises, it walks the *entire* session history on every
  picker open (already `useMemo`'d, so only on an actual open, not every render). Real
  routines almost always have well more than 8 distinct exercises across a weekly split, so
  this is a low-probability edge case with a bounded, non-catastrophic cost even when hit
  (a full history scan is still fast in JS for realistic history sizes). Not fixed —
  correctly triaged as not worth the added complexity of a scan-distance cap for this
  audit's risk/impact bar.
- **"Disconnect Strava" has no confirmation dialog.** It's a one-tap action with no undo,
  but reconnecting is trivial (one OAuth round-trip), so the cost of a wrong tap is low.
  Left as-is; flagged here rather than silently skipped.
- **Weight/notes inputs have no debounce.** The underlying work per keystroke (a local
  `useState` update, or in `ExercisePicker`'s case a ≤550-item catalog scan) is cheap
  enough that debouncing wouldn't produce a measurable improvement — not a real
  inefficiency, just flagged and dismissed during the audit rather than skipped without
  consideration.

---

## Testing gaps (honest accounting)

This repo's established testing convention (`CLAUDE.md`) is: pure functions and
`api/_lib/*` helpers get direct unit tests; Zustand stores get tested with services mocked
at the boundary. **No existing test in this repo exercises a full API route handler**
(the `export default async function handler(req: Request)` files under `api/*/`,
`api/chat/*`, `api/sheets/*`, `api/strava/*`) — only the pure helper functions those
handlers call are tested. Two of the changes in this audit (1.5's sheets-sync checkpoint
fix, 1.3's inbound-history cap) touch handler-level code with no existing test harness to
extend. Building that harness from scratch (mocking `Request`/`Response` under the Edge
runtime, `requireUser`, etc.) would be a real, standalone piece of infrastructure work —
flagging it here as a legitimate follow-up rather than quietly skipping verification or
overreaching with an untested new pattern under time pressure. Every other change in this
audit is either covered by the existing suite (which all 272 tests still pass against) or
is a pure reordering/memoization with no behavior change to verify beyond "output is
identical."

`TrendsTab.tsx` and `SyncTab.tsx` also have no dedicated test file in this repo (unlike
`HistoryTab.tsx`, `CoachTab.tsx`, `ExerciseLogger.tsx`) — the changes made to those two
files were verified by careful manual diff review and the full suite/build/typecheck,
not by a new or existing test targeting those exact components.

## What was deliberately not chased

Per this audit's own framework ("don't flag hypothetical scale issues" — this is a
personal, single/few-user app), several categories of finding were considered and
consciously not pursued:
- Any change whose value only materializes at real multi-user or high-row-count scale.
- The atomic-jsonb-write RPC redesign (§2.3) — real but low-probability/low-consequence
  given single-owner usage, and a genuinely bigger architectural change than the rest of
  this audit's scope.
- `npm audit`'s reported vulnerabilities (2 moderate, 4 high, 2 critical at time of
  writing) — out of scope for a performance/efficiency audit, and `npm audit fix --force`
  can introduce breaking dependency-version changes that need their own dedicated review
  and testing pass, not a blind fix bundled into this branch.
