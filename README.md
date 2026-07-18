# Ledger

**Live app: [aseem-ledger.vercel.app](https://aseem-ledger.vercel.app/)**

A training log built for one job: **record a set in under three seconds, one-handed, in a gym.**

Everything else — history, trends, Sheet sync — is secondary to that.

---

## Stack

- **React 18 + TypeScript + Vite**, Zustand for state, CSS Modules for styling, `vite-plugin-pwa` for offline/installable support
- **Supabase Auth** (Google OAuth) for sign-in, plus one small `profiles` table mapping each signed-in user to their own Google Sheet
- **Each user's actual workout data lives in their own Google Sheet**, written/read through an Apps Script Web App bridge (`apps-script.gs`) — not in Supabase. Supabase only handles "who are you" and "which Sheet is yours."
- Deployed on **Vercel** (free tier)

Nothing here costs money at personal-use scale: Vercel Hobby, Supabase free tier, and a Google Sheet are all free.

---

## How data is isolated between users

This matters enough to spell out, since more than one person can sign in:

- **Identity & routing** (Supabase): the `profiles` table has row-level security — a user can only ever `select`/`insert`/`update` the row matching their own `auth.uid()`. Verified live against the database (not just reviewed in code): an authenticated request with `select=*` and no filter still only returns the caller's own row; an unauthenticated request returns none.
- **Workout data** (Google Sheets): lives entirely outside Supabase, in each user's own Sheet, reachable only via the Apps Script URL they configured. There's no shared backend table of session data to leak across users.
- **Local cache** (browser): the Zustand `persist` cache is namespaced by user id (`ledger.sessions.<uid>`, `ledger.body.<uid>`), and gets explicitly blanked before every rehydrate on sign-in/out — so switching accounts on a shared device can't leave one person's cached workouts visible to the next.

Known residual limitation: an Apps Script Web App URL itself isn't cryptographically secret, just obscure (anyone who has the exact URL could hit it directly, bypassing the app). This is a pre-existing tradeoff of the "your own free Google Sheet as a database" design, not something introduced by the auth layer — worth knowing about, not yet hardened further.

---

## Setup (for a new deploy / new contributor)

### 1. Google Sheet + Apps Script (per user, ~5 min)

1. `sheets.new` → rename the file (e.g. "Ledger Log")
2. Extensions → Apps Script → delete the placeholder → paste in all of `apps-script.gs` → Save
3. Deploy → New deployment → type: **Web app**, Execute as: **Me**, Who has access: **Anyone**
4. Copy the `/exec` URL — you'll paste this into the app's onboarding screen (or Sync tab) after signing in

If you're migrating a Sheet that predates the current column format, run `migrateSessionsSheetFormat_` once from the Apps Script editor's function dropdown (details in the comment block at the top of `apps-script.gs`).

### 2. Supabase project (once, for the whole app)

1. Create a free project at [supabase.com](https://supabase.com)
2. Authentication → Providers → enable **Google** — needs a Google Cloud OAuth Client ID + Secret (Google Cloud Console → APIs & Services → Credentials → OAuth client ID → Web application → Authorized redirect URI = the Callback URL Supabase shows you on that same page)
3. Authentication → URL Configuration → Redirect URLs → add your deployed URL and `http://localhost:5173`
4. SQL Editor → run all of `supabase/profiles.sql` (creates the `profiles` table, RLS policies, and an auto-create-on-signup trigger)
5. Settings → API → copy the **Project URL** and **anon/publishable key**

### 3. Environment variables

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Locally: put these in `.env.local` (gitignored). On Vercel: Project Settings → Environment Variables → add both → redeploy (Vite bakes them in at build time, so a redeploy is required after adding/changing them — just saving the vars isn't enough).

### 4. Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build
npm test         # vitest
```

First sign-in on a fresh account lands on an onboarding screen asking for the Apps Script URL from step 1 — paste it once, and it's remembered on that account from then on, on any device.

---

## Session codes

| Code | Session | Day |
|---|---|---|
| `LA` | Lower A — Power & Strength | Mon |
| `SP` | Sprint Intervals | Tue AM |
| `PU` | Push — Shoulder-dominant | Tue PM |
| `PL` | Pull — Back Width | Thu |
| `LB` | Lower B — Glutes & Posterior | Sat |

The app picks today's session automatically, but any session can be logged on any day — the schedule bends, the training doesn't.

---

## Changing the program

The training program (exercises, targets, starting weights, coaching cues, rest-day prescriptions) lives in `public/config.json`, fetched at runtime — no rebuild needed to tweak it:

```json
{"k": "SQ", "n": "Back Squat", "s": 4, "r": 6, "w": 75, "u": "lb", "group": "Legs", "cue": "..."}
```

`k` = code, `n` = name, `s`/`r` = sets/reps, `w` = starting weight, `u` = unit, `group` = muscle group (drives the Trends tab filter). Keep `k` codes stable once you've logged against them — they're what links history together across sessions and what the Sheet's `sets` column keys off of.
