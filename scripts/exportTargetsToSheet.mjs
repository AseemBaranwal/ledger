#!/usr/bin/env node
// Ad-hoc export: pushes the owner's CURRENT program targets (what every
// exercise is targeted at for the next time that session comes up) into a
// "Targets" tab in the Ledger Log sheet — distinct from
// exportSessionsToSheet.mjs, which exports historical logged sessions.
// Lets the owner hand the sheet to an external assistant without needing
// this app's UI. Requires the Targets-tab Apps Script addition (see
// /tmp/apps-script-targets-patch.gs / issue #37) to be pasted into the
// live Apps Script project first.
//
// Run manually: node scripts/exportTargetsToSheet.mjs
//
// Requires the same .env.local vars as exportSessionsToSheet.mjs:
// SUPABASE_SERVICE_ROLE_KEY, LEDGER_SHEET_SCRIPT_URL, VITE_SUPABASE_URL,
// VITE_CHAT_OWNER_EMAIL.

process.loadEnvFile('.env.local')

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

async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  const profiles = await restGet(`profiles?email=eq.${encodeURIComponent(OWNER_EMAIL)}&select=routine_config`).catch((e) => {
    console.error(`Could not find a profile for ${OWNER_EMAIL}:`, e.message)
    process.exit(1)
  })
  const program = profiles?.[0]?.routine_config?.program
  if (!program || !Object.keys(program).length) {
    console.error('No routine_config.program found for this profile.')
    process.exit(1)
  }

  const targets = []
  for (const [sessionCode, session] of Object.entries(program)) {
    for (const ex of session.ex || []) {
      targets.push({ session: sessionCode, code: ex.k, name: ex.n || ex.k, group: ex.group, weight: ex.w, unit: ex.u, reps: ex.r, sets: ex.s })
    }
  }

  console.log(`Syncing ${targets.length} exercise target(s) across ${Object.keys(program).length} session(s)...`)

  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'targets', targets }),
  })
  const text = await res.text()
  if (!res.ok || text.startsWith('error')) {
    console.error('Failed:', text)
    process.exit(1)
  }
  console.log('Done — see the "Targets" tab.')
}

main()
