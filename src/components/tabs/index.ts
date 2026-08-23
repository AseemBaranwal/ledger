export { TodayTab } from './TodayTab'
export { HistoryTab } from './HistoryTab'
export { TrendsTab } from './TrendsTab'
export { SyncTab } from './SyncTab'
// CoachTab is deliberately NOT re-exported here. App.tsx loads it via its
// own lazy(() => import('@/components/tabs/CoachTab')) specifically so
// react-markdown (only used by CoachTab, ~35KB gzipped) ships in its own
// chunk instead of the main bundle every visitor downloads. A static
// `export { CoachTab } from './CoachTab'` here defeated that: Rollup pulled
// CoachTab's whole module graph into the same chunk as this barrel (which
// App.tsx also statically imports for the other four tabs), so the dynamic
// import never actually split it out — confirmed via `npm run build`,
// which produced no separate CoachTab-*.js chunk at all before this fix.
