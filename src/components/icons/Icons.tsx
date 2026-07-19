// Small inline-style icons for one-off UI glyphs (star markers, chevrons,
// close buttons). Unlike TabIcons.tsx these carry their own stroke/size
// since they're used outside the `.tab svg` cascade — sized in `em` so
// they scale with whatever font-size their parent already sets.

interface IconProps {
  size?: string
}

export function StarIcon({ size = '1em' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, display: 'inline-block', verticalAlign: '-0.12em' }}
      stroke="currentColor"
      fill="none"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
    </svg>
  )
}

export function CheckIcon({ size = '1em' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, display: 'inline-block', verticalAlign: '-0.1em' }}
      stroke="currentColor"
      fill="none"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  )
}

export function ChevronIcon({ open, size = '1em' }: IconProps & { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        transform: open ? 'rotate(90deg)' : 'none',
        transition: 'transform 0.15s ease',
      }}
      stroke="currentColor"
      fill="none"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

export function CloseIcon({ size = '1em' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, display: 'inline-block' }}
      stroke="currentColor"
      fill="none"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function SwapIcon({ size = '1em' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, display: 'inline-block' }}
      stroke="currentColor"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h13M17 8l-3.2-3.2M17 8l-3.2 3.2" />
      <path d="M20 16H7M7 16l3.2-3.2M7 16l3.2 3.2" />
    </svg>
  )
}

export function TrashIcon({ size = '1em' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, display: 'inline-block' }}
      stroke="currentColor"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 6.5h15M9 6.5V4.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.7M18 6.5l-.7 12.6a1.6 1.6 0 0 1-1.6 1.5H8.3a1.6 1.6 0 0 1-1.6-1.5L6 6.5" />
    </svg>
  )
}

export function PlusIcon({ size = '1em' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, display: 'inline-block' }}
      stroke="currentColor"
      fill="none"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4.5v15M4.5 12h15" />
    </svg>
  )
}

export function SearchIcon({ size = '1em' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, display: 'inline-block' }}
      stroke="currentColor"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M19.5 19.5l-4.6-4.6" />
    </svg>
  )
}
