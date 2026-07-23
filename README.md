# Ledger

**Live app: [aseem-ledger.vercel.app](https://aseem-ledger.vercel.app/)**

A training log built for one job: **record a set in under three seconds, one-handed, in a gym.**

Everything else — history, trends, sync — is secondary to that. Sign in with Google and start logging immediately — no spreadsheet or manual setup required.

---

## Stack

- **React 18 + TypeScript + Vite**, Zustand for state, CSS Modules for styling, `vite-plugin-pwa` for offline/installable support
- **Supabase** (Postgres + Google OAuth) for everything: auth, each user's own training program (`profiles.routine_config`), and every logged workout (`sessions` table) — one backend, no external spreadsheet dependency
- A brand-new user gets a generic starter training program (`src/data/starterProgram.ts`) automatically on first sign-in, editable from there on
- Deployed on **Vercel** (free tier)

Nothing here costs money at personal-use scale: Vercel Hobby and Supabase's free tier cover it.

---

## How data is isolated between users

This matters enough to spell out, since more than one person can sign in:

- **Identity & settings** (`profiles` table): row-level security — a user can only ever `select`/`insert`/`update` the row matching their own `auth.uid()`. Verified live against the database (not just reviewed in code): an authenticated request with `select=*` and no filter still only returns the caller's own row; an unauthenticated request returns none.
- **Workout data** (`sessions` table): same RLS pattern — every policy is scoped to `auth.uid() = user_id`, written directly by the client, no server proxy involved. See `supabase/sessions.sql`.
- **Local cache** (browser): the Zustand `persist` cache is namespaced by user id (`ledger.sessions.<uid>`, `ledger.body.<uid>`), and gets explicitly blanked before every rehydrate on sign-in/out — so switching accounts on a shared device can't leave one person's cached workouts visible to the next.

---

## Setup (for a new deploy / new contributor)

### 1. Supabase project (once, for the whole app)

1. Create a free project at [supabase.com](https://supabase.com)
2. Authentication → Providers → enable **Google** — needs a Google Cloud OAuth Client ID + Secret (Google Cloud Console → APIs & Services → Credentials → OAuth client ID → Web application → Authorized redirect URI = the Callback URL Supabase shows you on that same page)
3. Authentication → URL Configuration → Redirect URLs → add your deployed URL and `http://localhost:5173`
4. SQL Editor → run each file in `supabase/*.sql` (at minimum `profiles.sql` and `sessions.sql` — creates the tables, RLS policies, and an auto-create-on-signup trigger for `profiles`)
5. Settings → API → copy the **Project URL** and **anon/publishable key**

### 2. Environment variables

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Locally: put these in `.env.local` (gitignored). On Vercel: Project Settings → Environment Variables → add both → redeploy (Vite bakes them in at build time, so a redeploy is required after adding/changing them — just saving the vars isn't enough).

### 3. AI Coach chat (optional, owner-only)

A chat tab that answers questions about your own logged training data and can propose weight changes you accept yourself — it does not write anything on its own. Billed to your own Anthropic API key, separately from any Claude subscription; skip this section entirely if you don't want the feature.

1. Create an API key at [console.anthropic.com](https://console.anthropic.com) — this is separate, pay-per-token billing, not covered by a Claude Pro/Max/Team subscription
2. SQL Editor → run all of `supabase/chat_logs.sql`
3. In Vercel's dashboard (never in `.env.example`, never committed), set:
   - `ANTHROPIC_API_KEY` — the key from step 1
   - `CHAT_OWNER_USER_ID` — your Supabase `auth.users.id` (comma-separated if you ever want more than one allow-listed account); this is the real access gate
   - `CHAT_DAILY_LIMIT` / `CHAT_WINDOW_LIMIT` — optional, default to 60/day and 10 per 10 minutes if unset
4. Set `VITE_CHAT_OWNER_EMAIL` (see `.env.example`) — client-safe, only hides the tab for everyone else; not a security boundary on its own
5. Redeploy, then paste your own coaching instructions into the delimited block in `api/_lib/chatSystemPrompt.ts`

### 4. Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build
npm test         # vitest
```

First sign-in on a fresh account goes straight into the app — a generic starter training program is seeded automatically, no manual setup step.

---

## Session codes

Every user has their own program, so session codes aren't a fixed global
list — they're whatever that person's program defines. The starter
template (`src/data/starterProgram.ts`) a new sign-up gets ships with
three:

| Code | Session | Day |
|---|---|---|
| `PUSH` | Push — Chest, Shoulders, Triceps | Mon |
| `PULL` | Pull — Back, Biceps | Wed |
| `LEGS` | Legs — Quads, Hamstrings, Glutes | Fri |

The app picks today's session automatically, but any session can be logged on any day — the schedule bends, the training doesn't.

---

## Changing the program

Each user's program (exercises, targets, starting weights, coaching cues, rest-day prescriptions) lives in their own `profiles.routine_config` — same JSON shape as the old static `config.json` this replaced:

```json
{"k": "SQ", "n": "Back Squat", "s": 4, "r": 6, "w": 75, "u": "lb", "group": "Legs", "cue": "..."}
```

`k` = code, `n` = name, `s`/`r` = sets/reps, `w` = starting weight, `u` = unit, `group` = muscle group (drives the Trends tab filter). Keep `k` codes stable once you've logged against them — they're what links history together across sessions.

There's no in-app program editor yet (planned, not built) — for now, editing your own program means updating your `profiles.routine_config` row directly in the Supabase dashboard. `src/data/starterProgram.ts` is what every *new* sign-up gets seeded with; editing it only affects future sign-ups, not existing users.
