import { useState } from 'react'

interface AvatarProps {
  name: string | null
  avatarUrl: string | null
  onClick?: () => void
}

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

export function Avatar({ name, avatarUrl, onClick }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const showImage = avatarUrl && !imgFailed

  return (
    <button
      onClick={onClick}
      title={name || undefined}
      style={{
        width: '30px',
        height: '30px',
        borderRadius: '50%',
        flex: 'none',
        overflow: 'hidden',
        border: '1px solid var(--line-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--raised)',
        cursor: onClick ? 'pointer' : 'default',
        padding: 0,
      }}
    >
      {showImage ? (
        <img
          src={avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)' }}>{initials(name)}</span>
      )}
    </button>
  )
}
