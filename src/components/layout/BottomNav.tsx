import styles from '../../styles/App.module.css'

interface BottomNavProps {
  activeTab: string
  onTabChange: (tab: 'today' | 'history' | 'trends' | 'sync' | 'coach') => void
  showCoach?: boolean
}

const TABS = [
  { id: 'today', label: 'Today', icon: '◉' },
  { id: 'history', label: 'History', icon: '≡' },
  { id: 'trends', label: 'Trends', icon: '📈' },
  { id: 'sync', label: 'Sync', icon: '↔' },
  { id: 'coach', label: 'Coach', icon: '💬' },
]

export function BottomNav({ activeTab, onTabChange, showCoach }: BottomNavProps) {
  const tabs = showCoach ? TABS : TABS.filter((tab) => tab.id !== 'coach')

  return (
    <nav className={styles.tabs}>
      <div className={styles.tabsIn} style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.on : ''}`}
            onClick={() => onTabChange(tab.id as any)}
          >
            <span style={{ fontSize: '20px' }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
