import { useEffect } from 'react'
import { useUIStore } from '@/store'
import styles from '../../styles/App.module.css'

export function Toast() {
  const notifications = useUIStore((s) => s.notifications)
  const dismissNotification = useUIStore((s) => s.dismissNotification)

  useEffect(() => {
    if (notifications.length === 0) return

    // Error messages tend to carry more to read (what failed, sometimes
    // why) than a short success confirmation — give them a bit longer
    // before they disappear.
    const duration = notifications[0].type === 'error' ? 4500 : 3000
    const timer = setTimeout(() => {
      dismissNotification(notifications[0].id)
    }, duration)

    return () => clearTimeout(timer)
  }, [notifications, dismissNotification])

  if (notifications.length === 0) return null

  const notification = notifications[0]
  return (
    <div className={`${styles.toast} ${styles[notification.type]} ${notifications.length > 0 ? styles.up : ''}`}>
      {notification.message}
    </div>
  )
}
