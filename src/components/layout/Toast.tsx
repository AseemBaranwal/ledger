import { useEffect } from 'react'
import { useUIStore } from '@/store'
import styles from '@/styles/App.module.css'

export function Toast() {
  const notifications = useUIStore((s) => s.notifications)
  const dismissNotification = useUIStore((s) => s.dismissNotification)

  useEffect(() => {
    if (notifications.length === 0) return

    const timer = setTimeout(() => {
      dismissNotification(notifications[0].id)
    }, 3000)

    return () => clearTimeout(timer)
  }, [notifications, dismissNotification])

  if (notifications.length === 0) return null

  const notification = notifications[0]
  return (
    <div className={`${styles.toast} ${notifications.length > 0 ? styles.up : ''}`}>
      {notification.message}
    </div>
  )
}
