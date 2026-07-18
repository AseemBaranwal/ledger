import styles from '../../styles/App.module.css'
import { TodayIcon, HistoryIcon, TrendsIcon, SyncIcon, CoachIcon } from '../icons/TabIcons'

interface BottomNavProps {
  activeTab: string
  onTabChange: (tab: 'today' | 'history' | 'trends' | 'sync' | 'coach') => void
  showCoach?: boolean
}

const TABS = [
  { id: 'today', label: 'Today', Icon: TodayIcon },
  { id: 'history', label: 'History', Icon: HistoryIcon },
  { id: 'trends', label: 'Trends', Icon: TrendsIcon },
  { id: 'sync', label: 'Sync', Icon: SyncIcon },
  { id: 'coach', label: 'Coach', Icon: CoachIcon },
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
            <tab.Icon />
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
