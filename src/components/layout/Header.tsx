import styles from '../../styles/App.module.css'

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
          LED<em>G</em>ER
        </div>
        <div className={styles.topMeta}>
          <b>{date}</b>
          <span>{streak ? `${streak} week streak` : 'no streak yet'}</span>
        </div>
      </div>
    </header>
  )
}
