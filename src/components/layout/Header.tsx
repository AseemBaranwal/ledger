import { Avatar } from './Avatar'
import styles from '../../styles/App.module.css'

interface HeaderProps {
  date: string
  streak: number
  onLogoClick: () => void
  userName?: string | null
  userAvatarUrl?: string | null
  onAvatarClick?: () => void
}

export function Header({ date, streak, onLogoClick, userName, userAvatarUrl, onAvatarClick }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerIn}>
        <div className={styles.brand} onClick={onLogoClick}>
          LED<em>G</em>ER
        </div>
        <div className={styles.topMeta}>
          <b>{date}</b>
          <span>{streak ? `${streak} week streak` : 'no streak yet'}</span>
        </div>
        {(userName || userAvatarUrl) && (
          <Avatar name={userName ?? null} avatarUrl={userAvatarUrl ?? null} onClick={onAvatarClick} />
        )}
      </div>
    </header>
  )
}
