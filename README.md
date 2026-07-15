# Ledger

**Live app: [aseem-ledger.netlify.app](https://aseem-ledger.netlify.app/)**

A training log built for one job: **record a set in under three seconds, one-handed, in a gym.**

Everything else — trends, body composition, the Claude export — is secondary to that.

---

## Deploy to Netlify (2 minutes)

There is no build step. It's one HTML file.

**Drag-and-drop (easiest):**

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag this whole folder onto the page
3. Done. You get a URL immediately.

**Via Git (if you want version control):**

```bash
git init && git add . && git commit -m "ledger"
# push to GitHub, then in Netlify: Add new site → Import from Git
# Build command:    (leave blank)
# Publish directory: .
```

**Then, on your phone:** open the URL → Share → **Add to Home Screen**. It runs full-screen like a native app and works offline.

---

## How the data works

| | |
|---|---|
| **Where it lives** | `localStorage` on your phone. No account, no server, no cost. |
| **Offline** | Fully. The gym basement doesn't matter. |
| **Backup** | Sync tab → *Download backup*. Do this occasionally — clearing your browser wipes the data. |

⚠️ **The data is on one device.** It does not sync between your phone and laptop. Download a backup before you clear browser data, get a new phone, or do anything drastic.

---

## Getting data to Claude

Two ways. Pick either — or use both.

### 1. Copy for Claude (works immediately, zero setup)

Sync tab → **Copy for Claude** → paste into the chat.

The format is deliberately terse. A full training week costs roughly **400 tokens** instead of the ~4,000 raw JSON would burn:

```
S 2026-07-13 LA RSL2
SQ 75 6,6,6,5
BSS 20 8,8,8,8
RDL 65 8,8,8
SCR 25 12,12,12,10
# calves burned, never trained these before

B 2026-07-13 159.2 23.1 68.9 - 14
```

`S` = session (date, code, gym), then one line per lift: `code weight reps`.
`B` = body scan. `#` = a note. `-` = not measured.

**Mark as sent** after each export so the next one only includes what's new.

### 2. Google Sheet auto-sync (5-minute setup, then never touch it)

Every saved session also appends to a Google Sheet. Since Claude can read your Drive, check-ins then need **no pasting at all** — just say "check in."

Setup is in **`apps-script.gs`** — the steps are at the top of that file. Once you have the `/exec` URL, paste it into Sync → *Apps Script Web App URL*.

---

## Session codes

| Code | Session | Day |
|---|---|---|
| `LA` | Lower A — Power & Strength | Mon |
| `SP` | Sprint Intervals | Tue AM |
| `PU` | Push — Shoulder-dominant | Tue PM |
| `PL` | Pull — Back Width | Thu |
| `LB` | Lower B — Glutes & Posterior | Sat |

The app picks today's session automatically, but you can log any session on any day — the schedule bends, the training doesn't.

---

## Changing the program

All of it lives in the `PROGRAM` object at the top of the `<script>` in `index.html`. Exercises, targets, starting weights, and coaching cues are plain data:

```js
{k:'SQ', n:'Back Squat', s:4, r:6, w:75, u:'lb', cue:'...'}
//  ^code  ^name          ^sets ^reps ^start weight
```

Edit, save, redeploy. Keep the `k` codes stable — they're what links your history together and what the digest uses.
