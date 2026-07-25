import type { Equipment } from '@/services/exerciseCatalog'

interface EquipmentIconProps {
  equipment: Equipment
  size?: string
}

// One glyph per Equipment category (see api/_lib/exerciseCatalog.ts's
// equipmentForType for how a code maps to one of these) — same
// viewBox/stroke conventions as Icons.tsx so it drops into the same rows
// without any extra sizing rules.
const PATHS: Record<Equipment, JSX.Element> = {
  Barbell: (
    <>
      <path d="M3 12h18" />
      <rect x="4.2" y="6.5" width="2" height="11" rx="0.6" />
      <rect x="7" y="8.5" width="1.6" height="7" rx="0.6" />
      <rect x="17.8" y="6.5" width="2" height="11" rx="0.6" />
      <rect x="15.4" y="8.5" width="1.6" height="7" rx="0.6" />
    </>
  ),
  Dumbbell: (
    <>
      <circle cx="5" cy="12" r="3" />
      <circle cx="19" cy="12" r="3" />
      <path d="M8 12h8M8.5 9.5v5M15.5 9.5v5" />
    </>
  ),
  Machine: (
    <>
      <rect x="7" y="4" width="10" height="16" rx="1.2" />
      <path d="M9.2 8h5.6M9.2 11h5.6M9.2 14h5.6M9.2 17h5.6" />
    </>
  ),
  Cable: (
    <>
      <circle cx="12" cy="6" r="3" />
      <path d="M12 9v9M8 18h8" />
    </>
  ),
  Kettlebell: (
    <>
      <circle cx="12" cy="15" r="6" />
      <path d="M9 10a3 3 0 0 1 6 0" />
    </>
  ),
  Box: (
    <>
      <rect x="5" y="9" width="14" height="10" rx="1" />
      <path d="M5 9l7-3.5 7 3.5" />
    </>
  ),
  Band: <path d="M6 5c-3 3.5-3 10.5 0 14M18 5c3 3.5 3 10.5 0 14" />,
  Plate: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.3" />
    </>
  ),
  Rings: (
    <>
      <path d="M8 3v10M16 3v10" />
      <circle cx="8" cy="16.3" r="2.3" />
      <circle cx="16" cy="16.3" r="2.3" />
    </>
  ),
  MedicineBall: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M6.3 8c3 2.6 8.4 2.6 11.4 0M6.3 16c3-2.6 8.4-2.6 11.4 0" />
    </>
  ),
  StabilityBall: (
    <>
      <circle cx="12" cy="11" r="7" />
      <path d="M4 19h16" />
    </>
  ),
  Bodyweight: (
    <>
      <circle cx="12" cy="5" r="2.4" />
      <path d="M12 8v6M8.5 11l3.5-1 3.5 1M8.5 20l3.5-6 3.5 6" />
    </>
  ),
}

export function EquipmentIcon({ equipment, size = '1em' }: EquipmentIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, display: 'inline-block', flex: 'none' }}
      stroke="currentColor"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[equipment]}
    </svg>
  )
}
