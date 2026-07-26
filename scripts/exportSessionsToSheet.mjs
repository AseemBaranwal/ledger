#!/usr/bin/env node
// Ad-hoc export: pushes newly-logged PROGRAM sessions from Supabase into the
// owner's "Ledger Log" Google Sheet via its still-live Apps Script Web App.
// The website no longer talks to Sheets at all (see CLAUDE.md) — that
// removal deleted the code, not the deployed Apps Script, which is bound
// directly to the sheet and still accepts the same `type: 'session'` POST
// shape the old client used. sessions.d/s/g/ex/n map onto it unchanged.
//
// Run manually (intended: weekly): node scripts/exportSessionsToSheet.mjs
//
// Requires in .env.local (gitignored, never commit):
//   SUPABASE_SERVICE_ROLE_KEY  — bypasses RLS so this script can run
//                                 outside a signed-in browser session
//   LEDGER_SHEET_SCRIPT_URL    — the Apps Script /exec Web App URL
// Reuses VITE_SUPABASE_URL and VITE_CHAT_OWNER_EMAIL, already present.

process.loadEnvFile('.env.local')

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SCRIPT_URL = process.env.LEDGER_SHEET_SCRIPT_URL
const OWNER_EMAIL = process.env.VITE_CHAT_OWNER_EMAIL

for (const [name, value] of Object.entries({ VITE_SUPABASE_URL: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, LEDGER_SHEET_SCRIPT_URL: SCRIPT_URL, VITE_CHAT_OWNER_EMAIL: OWNER_EMAIL })) {
  if (!value) {
    console.error(`Missing ${name} in .env.local`)
    process.exit(1)
  }
}

// Tracks the created_at of the last successfully exported row so reruns
// (e.g. the weekly cadence this is meant for) only send what's new — keyed
// by insertion time rather than the session's own date (`d`), since a
// backdated session logged later would otherwise be silently skipped by a
// date-based checkpoint.
const CHECKPOINT_PATH = fileURLToPath(new URL('./.sheet-export-checkpoint.json', import.meta.url))

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_PATH)) return null
  try {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8')).lastExportedAt ?? null
  } catch {
    return null
  }
}

function saveCheckpoint(createdAt) {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify({ lastExportedAt: createdAt }, null, 2))
}

// Plain PostgREST calls rather than @supabase/supabase-js — the SDK's
// current version unconditionally constructs a Realtime client that needs
// native WebSocket (Node 22+); this script only ever does simple selects,
// so raw fetch against the REST endpoint sidesteps that entirely.
async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  const profiles = await restGet(`profiles?email=eq.${encodeURIComponent(OWNER_EMAIL)}&select=id`).catch((e) => {
    console.error(`Could not find a profile for ${OWNER_EMAIL}:`, e.message)
    process.exit(1)
  })
  const profile = profiles?.[0]
  if (!profile) {
    console.error(`Could not find a profile for ${OWNER_EMAIL}`)
    process.exit(1)
  }

  const since = loadCheckpoint()
  const sinceFilter = since ? `&created_at=gt.${encodeURIComponent(since)}` : ''
  const sessions = await restGet(
    `sessions?user_id=eq.${profile.id}&type=eq.PROGRAM&select=d,s,g,ex,n,created_at&order=created_at.asc${sinceFilter}`
  ).catch((e) => {
    console.error('Failed to read sessions:', e.message)
    process.exit(1)
  })
  if (!sessions?.length) {
    console.log(since ? `No new sessions since ${since}.` : 'No sessions found.')
    return
  }

  console.log(`Exporting ${sessions.length} session(s)${since ? ` since ${since}` : ''}...`)

  let maxCreatedAt = since
  let failures = 0
  for (const session of sessions) {
    if (!session.ex?.length) continue // no exercises logged — nothing to append

    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'session', d: session.d, s: session.s, g: session.g, ex: session.ex, n: session.n }),
    })
    const text = await res.text()
    if (!res.ok || text.startsWith('error')) {
      console.error(`  x ${session.d} (${session.s}): ${text}`)
      failures++
      continue // don't advance the checkpoint past a row that failed
    }
    console.log(`  ok ${session.d} (${session.s})`)
    maxCreatedAt = session.created_at
  }

  if (maxCreatedAt && maxCreatedAt !== since) saveCheckpoint(maxCreatedAt)
  console.log(failures ? `Done, with ${failures} failure(s).` : 'Done.')
  if (failures) process.exit(1)
}

main()
