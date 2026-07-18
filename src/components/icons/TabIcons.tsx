// Stroke-based nav icons. Color/size/stroke-width come from the `.tab svg`
// rule in App.module.css — these only define geometry.

export function TodayIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4.6" />
      <path d="M12 2.8v2.3M12 18.9v2.3M2.8 12h2.3M18.9 12h2.3" />
    </svg>
  )
}

export function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 4.2v5h5" />
      <path d="M4.7 9.2a8 8 0 1 1 1.3 8.1" />
      <path d="M12 8.2v4.3l3 2" />
    </svg>
  )
}

export function TrendsIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 16.5l5.5-5.5L12 14.5l7-7.5" />
      <path d="M15 7h4v4" />
    </svg>
  )
}

export function SyncIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4.5 12a7.5 7.5 0 0 1 13.6-4.3" />
      <path d="M19.5 12a7.5 7.5 0 0 1-13.6 4.3" />
      <path d="M17.6 3.6v4.4h-4.4" />
      <path d="M6.4 20.4V16h4.4" />
    </svg>
  )
}

export function CoachIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M5 5h14a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-8.6l-3.7 3a.4.4 0 0 1-.65-.31v-2.69H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
      <circle cx="8.4" cy="10.75" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="10.75" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="10.75" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}
