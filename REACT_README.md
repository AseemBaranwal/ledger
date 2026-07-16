# Ledger React v2.0

**Production-grade training log PWA built with React, TypeScript, and Zustand**

Live: https://aseem-ledger.netlify.app (after Vercel setup)

## Quick Start

```bash
# Install
npm install

# Development
npm run dev

# Build
npm run build

# Test
npm run test

# Deploy (Vercel auto-deploys from GitHub)
git push
```

## Architecture

### Frontend Stack
- **React 18** — UI framework
- **TypeScript** — Type safety
- **Zustand** — State management (4 lightweight stores)
- **Vite** — Fast builds
- **CSS Modules** — Styling (no framework)
- **Vitest** — Testing

### Directory Structure
```
src/
├── components/        # React components
│   ├── layout/       # Header, BottomNav, Toast
│   ├── tabs/         # TodayTab, HistoryTab, TrendsTab, SyncTab
│   ├── session/      # ExerciseLogger
│   └── trends/       # Charts (expandable)
├── store/            # Zustand stores
│   ├── sessionStore  # Sessions + draft
│   ├── configStore   # Training program + config
│   ├── uiStore       # Tabs, filters, notifications
│   └── bodyStore     # Body composition
├── services/         # Business logic
│   ├── appScript.ts  # Google Sheets API
│   ├── dateUtils.ts  # Date helpers (timezone-aware)
│   ├── trendCalculations.ts  # Volume, PRs
│   └── localStorage.ts       # Persistence
├── types/            # TypeScript definitions
├── styles/           # CSS Modules
└── App.tsx           # Root component
```

## Features

✅ **Session Logging** — Log exercises with per-set weights and reps
✅ **Session History** — View past workouts grouped by week
✅ **Trends** — Filter by muscle group, track max weights
✅ **Google Sheets Sync** — Auto-backup to sheets, restore from sheets
✅ **Progressive Overload** — Weights sheet in Google Sheets (update in separate chat)
✅ **Rest Day Logging** — Easy Run, Ice Skating with editable durations
✅ **Timer Beep** — Audio notification when rest timer expires
✅ **Offline** — PWA with full offline capability
✅ **Data Restore** — Recover from sheets if localStorage cleared
✅ **One-Handed UI** — Designed for use in the gym

## Data Model

### Session
```typescript
{
  id: string;
  d: string;          // ISO date
  s: string;          // Session code (LA, PU, PL, etc.)
  g: string;          // Gym
  ex: Exercise[];     // Exercises
  n: string;          // Notes
  type?: 'PROGRAM' | 'REST';
}
```

### Exercise
```typescript
{
  k: string;      // Code (SQ, BSS, etc.)
  r: number[];    // Reps per set [6, 6, 6, 6]
  ws: number[];   // Weights per set [75, 75, 75, 74]
  w?: number;     // Legacy: single weight
}
```

## Google Sheets Setup

1. Create a Google Sheet
2. Deploy Apps Script (see `apps-script.gs`)
3. Copy the `/exec` URL
4. Paste in Ledger → Sync tab
5. Create a "Weights" sheet for progressive overload (columns: Exercise Code, Starting Weight)

## State Management (Zustand)

All stores persist to localStorage automatically.

### sessionStore
- `sessions: Session[]` — All logged sessions
- `draft: Session` — In-progress session
- `addSession()`, `saveDraft()`, `logRep()`

### configStore
- `program: Program` — Training sessions (from config.json)
- `restDays: RestDays` — Rest day prescriptions
- `loadConfig()`, `loadWeights()` — Async data loading

### uiStore
- `activeTab: 'today' | 'history' | 'trends' | 'sync'`
- `selectedTrendGroup: string` — Filter for trends
- `notifications: Notification[]` — Toast messages
- `timerSeconds: number`, `timerActive: boolean`

### bodyStore
- `scans: BodyScan[]` — Weight, body fat, muscle mass
- `addScan()`, `deleteScan()`

## Styling

CSS Modules preserve the original design:
- **App.module.css** — Layout (header, tabs, shell)
- **components.module.css** — Cards, buttons, forms, charts
- **globals.css** — Variables, resets, typography

No Tailwind or external CSS libraries — hand-rolled design optimized for gym use.

## Testing

```bash
# Run tests
npm run test

# Watch mode
npm run test -- --watch

# Coverage
npm run test:coverage
```

Tests cover:
- Date utilities (timezone-aware iso formatting)
- Trend calculations (volume, PRs, max weight)
- Store state management
- API calls to Google Sheets

## Deployment

### Vercel (Recommended)

1. Connect GitHub repo to Vercel
2. Set build command: `npm run build`
3. Set output directory: `dist`
4. Deploy

Vercel auto-deploys on every push to main.

### CI/CD (GitHub Actions)

`.github/workflows/test.yml` runs tests and build on every PR.

## PWA Features

- ✅ Offline-first (service worker)
- ✅ Installable (manifest.json)
- ✅ Homescreen app icon
- ✅ Full offline capability

Install on phone: Share → Add to Home Screen

## Performance

- **Bundle:** ~150 KB (gzipped ~46 KB)
- **First Paint:** <500ms
- **Lighthouse:** 90+ score target
- **Offline:** Instant load from cache

## Migration from v1

The vanilla JS version (v1) is in `.backup/`. Data format is identical:
- `localStorage.ledger.v1` → `localStorage.ledger.sessions`, etc. (stores split)
- Google Sheets format unchanged
- config.json same structure

Existing users can restore from Sheets if they clear browser data.

## Development Tips

1. **Watch changes:** `npm run dev` starts Vite dev server at localhost:5173
2. **Debug stores:** Zustand stores are accessible in console: `zustand.useSessionStore.getState()`
3. **Test component:** Use `<Artifact>` to render components quickly
4. **TypeScript:** All files use strict mode (`noImplicitAny: true`)

## Next Steps

- [ ] Stream upcoming features to Weights sheet
- [ ] Add body metrics tracking UI
- [ ] Implement video cues for form checks
- [ ] Add periodization helpers (deload detection, phase tracking)
- [ ] Export to Strava/Apple Health

## License

Personal project. Use as you wish.

## Contact

Built for gym logging. Questions? Check the code — it's simple and well-organized.
