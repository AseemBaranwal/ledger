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
- **RLS pattern used throughout**: every user-data table has a
  `select`-own policy for the `authenticated` role and *no* insert/update/
  delete policies at all — only the `service_role` key (used exclusively
  server-side in `api/_lib/supabaseAdmin.ts`) can write. This is deliberate
  hardening, not an oversight — client code should never be able to write
  directly to `strava_connections`, `chat_logs`, or `chat_messages`.
- **`requireUser()` in `api/_lib/auth.ts` calls Supabase's `/auth/v1/user`
  REST endpoint directly via `fetch`, not the `supabase-js` SDK's
  `auth.getUser(jwt)`.** The SDK method threw a spurious `"Auth session
  missing!"` under Vercel's Edge Runtime even with a verified valid,
  unexpired token — never fully root-caused, not worth chasing further
  given the direct REST call works and is simpler anyway.

## Google Apps Script gotchas

- **`curl` needs `-L`** — Apps Script's `/exec` endpoint always responds
  with a 302 redirect to a `script.googleusercontent.com` URL for the
  actual payload; without `-L` you get the raw redirect HTML, not the data.
- **"New deployment" vs. "Manage deployments → edit existing" produce
  different `/exec` URLs.** Clicking "New deployment" mints a fresh URL
  even against the same script/spreadsheet, silently orphaning whatever
  URL the app currently has saved (the sheet's actual data isn't lost, just
  disconnected until the app's saved URL is updated). If a resync starts
  failing right after redeploying Apps Script, check whether the URL
  changed.
- **Sheets auto-converts number-like strings** (e.g. `"100,100,100,100"` →
  `100100100100`). `apps-script.gs` force-formats the sets column as text
  and has a recovery function for already-corrupted rows — don't remove the
  text-formatting call when touching sheet-write code.
- Monaco's auto-bracket-closing in the Apps Script web editor corrupts
  programmatically-typed code (keystroke simulation adds spurious closing
  brackets). Either have the user paste manually, or drive it via a
  temporary API hook + curl instead of typing into the editor.

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
