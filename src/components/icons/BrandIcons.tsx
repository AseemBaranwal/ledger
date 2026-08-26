// Simplified marks for third-party "connect" buttons (Strava, Google
// Health). Not the services' literal trademarked logo assets — a
// recognizable shape paired with the service's own brand color, the same
// convention most OAuth connect buttons use. Filled (not stroke) so a
// parent can just set `color` to swap between "on brand-colored badge"
// (white) and any other context.

interface BrandIconProps {
  size?: string
}

export function StravaMark({ size = '1em' }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size, display: 'block' }} fill="currentColor">
      <path d="M13.5 2 6.5 13.8h3.8L9 22l8.5-12.7h-3.8L17.5 2z" />
    </svg>
  )
}

export function GoogleHealthMark({ size = '1em' }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size, display: 'block' }} fill="currentColor">
      <path d="M12 20.3S2.6 15.3 2.6 8.9C2.6 5.7 5.1 3.4 8 3.7c1.7.2 3.1 1.2 4 2.6.9-1.4 2.3-2.4 4-2.6 2.9-.3 5.4 2 5.4 5.2 0 6.4-9.4 11.4-9.4 11.4z" />
    </svg>
  )
}
