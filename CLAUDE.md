# Ledger — working notes for Claude

Personal training-log PWA. React/Vite/TypeScript frontend, Vercel serverless
functions backend, Supabase (Postgres + Auth), Google Sheets (via Apps
Script) as the workout-data source of truth, Strava integration, and an
owner-only AI Coach chat backed by the Claude API directly (not Claude Code).

Full architecture is in [README.md](README.md). This file is a debugging
playbook — things that cost real time to figure out once and will cost it
again if forgotten.

## Testing convention

**Write tests for new logic as you write it, not as a follow-up.** This
project's test suite started thin (13 tests covering only date/trend
utilities and the session store) while a meaningful amount of custom logic
— Strava's weight-unit conversion and exercise mapping, the chat tool loop,
cost estimation — had zero coverage. Retrofitting tests after the fact
works but is strictly more expensive than writing them alongside the code,
and bugs that tests would have caught (e.g. an off-by-clamp in a duration
estimate) are easy to miss in manual browser verification alone.

Practical pattern established in `tests/unit/`:
- Pure functions (in `src/services/*.ts` or `api/_lib/*.ts`) get direct
  unit tests — no mocking needed, see `stravaMapping.test.ts` or
  `chatCost.test.ts` for the shape. `api/_lib/*.ts` files import fine from
  a test file via a relative path (`../../api/_lib/foo`) despite living
  outside `src/` — vitest resolves their internal `.js`-suffixed imports
  correctly, same as Vite does in dev.
- Zustand stores that call network services get tested with the service
  module mocked via `vi.mock('@/services/whatever', () => ({...}))` — see
  `chatStore.test.ts`. Don't mock `fetch`/Supabase directly; mock at the
  service-function boundary the store actually calls.
- Before trusting a new test, run it once and read the *failure* message
  carefully if it's red — two tests in `stravaMapping.test.ts` failed on
  first write because the test's own expectation was wrong (didn't account
  for a clamp), not the code. A red test isn't automatically a caught bug.

## Infra references

- Vercel project: `aseems-projects-a684aa0d/ledger` — prod domain
  `aseem-ledger.vercel.app`
- Supabase project ref: `xhtoupuwambuqwebmhwc`
- GitHub: `AseemBaranwal/ledger`
- SQL migrations live in `supabase/*.sql` — run manually in the Supabase SQL
  editor (or directly via the dashboard if already authenticated in-session;
  they're all idempotent `CREATE TABLE IF NOT EXISTS`, safe to re-run).

## Vercel Edge Functions — hard-won gotchas

- **Every `/api/*.ts` handler must set `export const config = { runtime: 'edge' }`.**
  Without it, Vercel's default Node runtime invokes the handler with a
  legacy Node-style request object whose `.headers` is a plain object, not a
  `Headers` instance — `req.headers.get(...)` throws `TypeError: req.headers.get
  is not a function`. This bit every endpoint once before the pattern was
  established; don't create a new endpoint without it.
- **Relative imports need explicit `.js` extensions** (`from '../_lib/auth.js'`,
  not `'../_lib/auth'`) — the root `package.json` has `"type": "module"`, so
  Vercel's Node/Edge runtime resolves these as native ESM at runtime, which
  requires extensions even though the source files are `.ts`. TypeScript
  compiles this fine either way (with `moduleResolution: "bundler"`); only
  the deployed runtime cares. Omitting it produces
  `Error [ERR_MODULE_NOT_FOUND]` in production that never shows up locally.
- **Edge Functions must send their first response byte within 25s** — this
  is a hard, non-configurable platform limit (confirmed via Vercel's own
  docs). It is specifically about *time to first byte*, not total duration —
  a function can keep streaming for up to 300s once it's started responding.
  Anything that might take a while (multi-step LLM tool loops, slow upstream
  APIs) must return a streaming `Response` immediately and write to it
  progressively, not buffer everything into one JSON response returned at
  the end. See `api/chat/message.ts` for the pattern (newline-delimited
  JSON status events + a final `done` event).
- **`supabase-js` without a generated `Database` type infers `never` for
  `.update()`/`.upsert()` payloads and `.select()` results** on tables it
  doesn't have types for — not `any`, as you'd expect from an untyped
  client. Cast the query builder to `any` at the call site
  (`(supabaseAdmin().from('table') as any).upsert(...)`) rather than fighting
  it; there's no generated Database type in this project and adding one is
  more machinery than the problem is worth.
- To type-check `api/**/*.ts` locally (excluded from the main
  `tsconfig.json`'s `include: ["src"]`, so `npm run build` never checks it):
  write a throwaway `tsconfig.api.check.json` with
  `{"include": ["api/**/*.ts"], "compilerOptions": {"moduleResolution": "bundler", "allowImportingTsExtensions": true, ...}}`,
  run `npx tsc -p` against it, delete it after. Do this before every push
  that touches `api/` — Vercel's own build doesn't type-check either, it
  just transpiles, so a type error here fails silently in production instead
  of at build time.

## Supabase gotchas

- **Vercel preview deployments get a new URL every push** (`ledger-<hash>-
  aseems-projects-a684aa0d.vercel.app`), and Supabase's OAuth "Redirect
  URLs" allowlist requires exact/wildcard matches — a preview URL that
  isn't covered silently falls back to the Site URL (which was
  `localhost:3000`, a stale default) instead of erroring. Fixed by adding
  `https://ledger-*-aseems-projects-a684aa0d.vercel.app/**` as a wildcard
  redirect URL in Supabase Auth → URL Configuration. If sign-in on a new
  preview URL ever redirects somewhere broken, check this first.
- **Two deliberate RLS patterns, not one** — pick based on data
  sensitivity, don't default to either without thinking about it:
  - *Service-role-write-only* (`strava_connections`, `chat_logs`,
    `chat_messages`): `select`-own policy only, no insert/update/delete for
    `authenticated` — only the `service_role` key (used exclusively
    server-side in `api/_lib/supabaseAdmin.ts`) can write. Used where the
    data is security-sensitive (OAuth tokens) or where a server-side
    invariant matters (chat history shouldn't be editable by the client).
  - *Direct client writes via `auth.uid() = user_id`* (`profiles`,
    `sessions`): select/insert/update(/delete) policies scoped to the
    caller's own row, written straight from the browser with the normal
    RLS-scoped `supabase` client — no server proxy. Used for benign
    per-user data where a proxy endpoint would add latency and code for no
    real security benefit. `sessions` (see below) is the newest table on
    this pattern.
- **`requireUser()` in `api/_lib/auth.ts` calls Supabase's `/auth/v1/user`
  REST endpoint directly via `fetch`, not the `supabase-js` SDK's
  `auth.getUser(jwt)`.** The SDK method threw a spurious `"Auth session
  missing!"` under Vercel's Edge Runtime even with a verified valid,
  unexpired token — never fully root-caused, not worth chasing further
  given the direct REST call works and is simpler anyway.

## Workout data lives in Supabase, not a Google Sheet (as of the
onboarding-removal migration)

- **`sessions` table is now the source of truth for logged workouts**,
  written directly by the client (`src/services/sessionsApi.ts`) via RLS —
  see `supabase/sessions.sql`. Each user's training program (previously
  the single static `public/config.json`, shared by everyone) now lives in
  their own `profiles.routine_config` jsonb column, seeded from
  `src/data/starterProgram.ts` on first sign-in
  (`configStore.loadOrSeedProgram`) so a brand-new user never has to set
  anything up. This was a deliberate pivot away from the Google
  Sheet/Apps Script setup a new user used to need before they could log
  a single set — see the git history around the commit that removed
  `OnboardingScreen.tsx`/`appScript.ts` for the full reasoning.
- **`supabase-js` does NOT throw on a query error** the way the old
  `no-cors` fetch calls to Apps Script effectively did (a resolved fetch
  was the only "it worked" signal available then) — `.insert()`/`.select()`
  resolve normally with `{error}` set for an RLS denial or constraint
  violation. Every write in `sessionsApi.ts` explicitly checks and throws
  on `error`; a naive port that skipped this would silently treat a real
  failure (e.g. an RLS policy denial) as a successful sync. Caught during
  the migration's own Plan review, not in production — worth remembering
  as a category of bug whenever porting code off a `no-cors` fetch pattern.
- **`apps-script.gs` still exists in the repo but is inert** — nothing in
  the running app calls it anymore. Kept only as scaffolding in case a
  "export your data to a Google Sheet" feature gets built later (a
  one-way export is a different shape of feature than "Sheet as required
  source of truth," so it'd likely be rewritten fresh rather than
  reactivating this file as-is). The gotchas below only apply if that
  happens — Monaco's auto-bracket-closing in the Apps Script web editor
  corrupts programmatically-typed code (paste manually, or drive it via a
  temporary API hook + curl); `curl` needs `-L` since `/exec` always
  302-redirects; "New deployment" mints a fresh URL and orphans the old
  one, unlike "Manage deployments → edit existing"; Sheets auto-converts
  number-like strings (e.g. `"100,100,100,100"` → `100100100100`) unless
  the column is force-formatted as text.

## Claude API integration (`api/_lib/anthropic.ts`)

- Model id: `claude-sonnet-5`. Reasoning effort is a **top-level `effort`**
  field on the Messages API request body (`"low" | "medium" | "high" | "max"`,
  default `"high"`) — not the older `thinking: { budget_tokens }` shape,
  which 400s on this model.
- No `@anthropic-ai/sdk` in this project (wouldn't run under Edge Runtime
  anyway) — raw `fetch` against `https://api.anthropic.com/v1/messages`,
  same pattern as the Strava REST calls.
- Tool use requires a **manual loop** (Edge Runtime can't use the SDK's
  `tool_runner`): call → check `stop_reason === 'tool_use'` → execute the
  tool → append a `tool_result` message → call again, capped at
  `MAX_TOOL_ITERATIONS` to bound cost on a runaway loop.
- Prompt caching: mark the system prompt block with
  `cache_control: { type: 'ephemeral', ttl: '1h' }`. The system prompt in
  `api/_lib/chatSystemPrompt.ts` is deliberately built as static, byte-stable
  string concatenation (no per-request interpolation) specifically so the
  cache doesn't invalidate every call.
- **`tools` doesn't need its own `cache_control` to be cached.** Anthropic's
  request render order is `tools → system → messages`; a single
  `cache_control` breakpoint on the *last* system block caches everything
  before it, tools included. So as long as `TOOLS` in `chatTools.ts` stays a
  static array (no per-request content), tool schemas are already covered
  by the existing system-prompt cache marker — confirmed against Anthropic's
  own prompt-caching docs before adding new tools, rather than assumed.
  Adding/removing/reordering a tool still busts the cache once (expected,
  same as any system-prompt edit) — it just isn't a *per-request* cost.

## Coach chat tools (`api/_lib/chatTools.ts`, `api/chat/message.ts`)

- The Coach can **propose** (never silently apply) three kinds of changes,
  each going through a dedicated write endpoint gated the same way as
  everything else in this file — owner-only, human-tap-to-accept, never
  direct LLM write access:
  - `get_training_data` — read-only, pulls from the Supabase `sessions`
    table (see the workout-data section above).
  - `suggest_exercise_adjustment` — weight/reps/sets, each field
    independently optional so a proposal can touch just one. Accept writes
    through `api/chat/apply-exercise-change.ts` to the user's own
    `profiles.routine_config` (read-modify-write — find the exercise by
    code across the program's sessions, mutate `w`/`r`/`s`, write the whole
    jsonb blob back; persistent "next time" target, same semantics
    weight-only suggestions always had) and additionally syncs the live
    session draft if one is active with that exercise.
  - `suggest_exercise_swap` — the model only ever sends a **plain-language
    guess** (`replacementQuery`, e.g. `"leg press"`); the ~500-entry Strava
    catalog never enters its context. Resolution happens server-side via
    `resolveExerciseQuery()` in the shared `api/_lib/exerciseCatalog.ts` —
    same module the frontend's manual swap picker uses, so a swap the Coach
    proposes and one picked by hand resolve identically. Unlike weight/reps/
    sets (written into the program's own `routine_config`), a swap doesn't
    touch the program definition itself — it's stored as a standing
    substitution on `profiles.exercise_substitutions` instead (see
    `supabase/exercise_substitutions.sql` — a jsonb column, not a new
    table, same reasoning as `routine_config`: a per-user setting, not an
    append-only log). Accepting one **always** writes that persistent
    substitution (regardless of whether a session is open) via
    `api/chat/apply-exercise-swap.ts`, *and* additionally patches the live
    draft immediately if one's open with that exercise right now — same
    dual-write pattern weight/reps/sets already used, just with a different
    storage target. `TodayTab.tsx`'s `withSubstitutions()` applies the
    standing map at both session-start and in the week-preview, so what you
    see before starting matches what you get after. The starting weight for
    a swapped-in exercise prefers the live `program` target over historical
    session logs — a same-conversation weight-suggestion accept updates
    `program` in memory immediately, but wouldn't show up in `sessions`
    (past logged workouts), so checking `sessions` alone would show a stale
    number.
- **A suggestion's accept/dismiss status must be persisted server-side, not
  just in local zustand state** — `chat_messages.suggestions` is a jsonb
  column with no partial-array-element update in supabase-js, so
  `updateSuggestionStatus()` in `api/_lib/chatHistory.ts` does a read-
  modify-write (select the row, mutate the one array index, write the whole
  array back) via `api/chat/update-suggestion-status.ts`. Miss this and
  every suggestion silently reverts to "pending" (re-showing clickable
  Accept/Dismiss buttons on an already-applied change) the next time
  `loadHistory()` runs — which is every time the Coach tab mounts, since it
  always re-fetches the durable copy. This bit the first version of both
  the adjustment and swap suggestion cards.
- **The model can hallucinate a suggestion — reply as if `suggest_exercise_swap`
  was called when it wasn't — and a prompt instruction alone doesn't
  reliably stop it.** Caught by checking `chat_logs.tool_calls` directly
  (`[]`, empty) against a reply reading "Queued: swap X → Y, ready to
  accept in the app" with no suggestion card able to render (`chat_messages
  .suggestions` was `NULL` for that turn). Root cause: the model had no way
  to know whether an *earlier* swap in the same conversation had actually
  been accepted, and hedged by describing one in prose instead of calling
  the tool again. Adding an explicit "never describe a suggestion you
  didn't actually propose" rule to the system prompt reduced but did
  **not** eliminate it — it recurred in the same session after that fix
  shipped. The more durable fix: `get_training_data` now also returns
  `activeSwaps` (from `profiles.exercise_substitutions`) so the model has
  the actual ground truth instead of needing to infer or hedge — since
  removing the *uncertainty* the hedging was protecting against works
  better than just forbidding the hedge. Lesson for future prompt work:
  don't assume one instruction-based fix is sufficient for a tool-call-
  skipping failure mode — verify against `chat_logs.tool_calls` after the
  fix ships, not just that the wording looks right.

## Strava gotchas

- **Uploads are tracked by `external_id` per athlete+app, and Strava honors
  a past deletion of that id** — reuse the same `external_id` (e.g. a
  hardcoded literal filename) on a later upload, and if an earlier upload
  with that id was deleted, the new one gets silently auto-deleted too. The
  accept response still looks completely normal (`200`, a real activity id);
  only the *polled* upload status reveals `"The created activity has been
  deleted."`. Always derive `external_id` from something genuinely unique
  per upload (session code + real timestamp).
- The structured "Exercises" cards (sets/reps/weight shown natively, not as
  text) require Strava's separate `POST /uploads` JSON-file format
  (`data_type=json`, weight in **kg**), restricted to
  WeightTraining/HIIT/Workout/Crossfit sport types — not the plain
  `POST /activities` endpoint, which only takes a text description.
  `exercise_type` values come from a large fixed vocabulary; see
  `api/_lib/stravaExerciseCatalog.ts` for the full reference list (kept
  complete, not just the subset this app currently maps to, for future use).
- Upload processing is async — `POST /uploads` just enqueues it; poll
  `GET /uploads/:id` for the real `activity_id`. Strava's docs list a <2s
  mean processing time, but real-world variance is higher, especially for
  Edge Function timeout math (see the 25s-first-byte note above).
- **`utc_offset` on the structured JSON upload is display-only — it does
  NOT affect how `start_time` is parsed.** Confirmed against Strava's docs:
  "Athlete's local UTC offset in seconds... Used for display purposes; does
  not affect how timestamps are parsed." `start_time` must already be a
  correct UTC instant (with `Z` or an offset) — this app's `resolveTiming()`
  already produced that correctly. The actual bug was `utc_offset`
  hardcoded to `0`, which told Strava's UI "the athlete is in UTC+0" —
  so a session really logged at 7am Pacific rendered on Strava at 2pm. The
  underlying instant was always right; only the *displayed* wall-clock time
  was wrong, which is why this was easy to miss in testing unless you
  actually checked the time shown on the Strava activity itself, not just
  that the post succeeded. Fixed by capturing `Date.getTimezoneOffset()`
  at session-start time (stored on `Session.tz`) and converting it via
  `stravaUtcOffsetSeconds()`/`toLocalNaiveIso()` in `api/_lib/stravaMapping.ts`
  — note JS's offset sign convention (positive = behind UTC) is inverted
  from Strava's (negative = behind UTC). The plain-activity fallback path
  (`start_date_local`, used for non-weight-training sport types like
  sprint sessions) had the same class of bug — it was being fed a UTC ISO
  string directly, which reads as literally-that-wall-clock-time to Strava
  since the field is documented as a naive local timestamp.

## Exercise swap / add / custom (`src/services/exerciseCatalog.ts`)

- **A logged exercise's `k` is "a code", not "a short code"** — nothing in
  the type system or the Sheet schema enforces the 2-4 letter convention
  used by `config.json`'s programmed exercises. The swap/add picker exploits
  this: picking something from Strava's catalog sets `k` to the Strava
  `exercise_type` constant itself (e.g. `"LEG_PRESS"`), and a free-text
  custom entry sets `k` to a normalized `CUSTOM_...` slug. Both skip needing
  a separate name-lookup table because `stravaExerciseTypeForCode` in
  `api/_lib/stravaMapping.ts` passes through any `k` that's already a valid
  Strava type unchanged — zero-maintenance Strava mapping for anything
  picked from the catalog.
- **`resolveExerciseDisplay()` is the single source of truth for "what do I
  show for this code"** — checked in order: the live `program` config, then
  the Strava catalog (name/group fully derived, no storage needed), then the
  local custom-exercise registry (`customExerciseStore.ts`, for free-text
  entries with no Strava match), then a raw-code fallback. `TrendsTab` and
  `HistoryTab` both call through this instead of their own program-only
  lookups — if a new display surface is added later, route it through here
  too rather than re-deriving name/group/colour inline.
- **`src/services/exerciseCatalog.ts` cross-imports `api/_lib/stravaExerciseCatalog.ts`
  and `api/_lib/stravaMapping.ts` directly** (not just from test files, as
  the testing-convention note above describes — this is the first *runtime*
  cross-import). Confirmed this actually bundles correctly in `vite build`,
  not just under vitest, before relying on it.
- **A session's exercise list is a separate mutable copy (`draftDefs` in
  `sessionStore.ts`), not a live view of `config.json`.** Swapping/adding/
  removing during a session never touches the static program — it only
  diverges `draftDefs` from `program[code].ex` for that one occurrence.
  `TodayTab` falls back to `program[code].ex` whenever `draftDefs` is null,
  which is both the pre-this-feature behavior and the fallback for a draft
  that was already in progress when this shipped (see `hydrateDraftDefs`).
- **Removal is guarded at the store level, not just hidden in the UI** —
  `removeExercise` silently no-ops if that exercise already has logged sets
  (`r.length > 0`), so a stray call can't drop real data even if the button
  that's supposed to be hidden somehow fires anyway.

## General debugging approach that actually worked this session

- **When something "works" (200 response) but produces no visible effect,
  check the actual server logs before guessing from the UI.** Several bugs
  this session (Strava's silent create-then-delete, the chat 504 timeout)
  were invisible from the client and only diagnosable via Vercel's function
  logs (`vercel.com/<project>/logs`, or `gh run` for CI). A clean-looking
  response is not proof of a working feature.
- **Verify fixes against the live/deployed environment, not just local
  build success.** Several fixes (Strava external_id, the auth rehydrate
  race, the Edge Runtime header bug) only reproduced in production/preview,
  never locally — `npm run build` passing is necessary, not sufficient.
- **Test the actual data path end-to-end** (a real curl/fetch call, a real
  browser click-through) rather than trusting an endpoint's shape alone —
  e.g. confirming a Supabase row genuinely exists via a direct SQL query,
  not just trusting a 200 from the write endpoint.
