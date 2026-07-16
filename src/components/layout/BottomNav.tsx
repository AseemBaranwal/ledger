import styles from '../../styles/App.module.css'

interface BottomNavProps {
  activeTab: string
  onTabChange: (tab: 'today' | 'history' | 'trends' | 'sync') => void
}

const TABS = [
  { id: 'today', label: 'Today', icon: '◉' },
  { id: 'history', label: 'History', icon: '≡' },
  { id: 'trends', label: 'Trends', icon: '📈' },
  { id: 'sync', label: 'Sync', icon: '↔' },
]

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className={styles.tabs}>
      <div className={styles.tabsIn}>
        {TABS.map((tab) => (
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
