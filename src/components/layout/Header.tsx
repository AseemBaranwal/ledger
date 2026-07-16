import styles from '@/styles/App.module.css'

interface HeaderProps {
  date: string
  streak: number
  onLogoClick: () => void
}

export function Header({ date, streak, onLogoClick }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerIn}>
        <div className={styles.brand} onClick={onLogoClick}>
          Ledger <em>.</em>
        </div>
        <div className={styles.topMeta}>
          <b>{date}</b>
          <span>{streak} workouts</span>
        </div>
      </div>
    </header>
  )
}
