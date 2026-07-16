import { useEffect, useRef } from 'react'
import { useUIStore } from '@/store'
import { playRestChime } from '@/services/audio'
import styles from '../../styles/components.module.css'

function buzz(pattern: number | number[] = 12) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern)
    } catch (e) {
      // ignore
    }
  }
}

export function RestTimer() {
  const timerActive = useUIStore((s) => s.timerActive)
  const timerSeconds = useUIStore((s) => s.timerSeconds)
  const setTimer = useUIStore((s) => s.setTimer)
  const tickTimer = useUIStore((s) => s.tickTimer)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!timerActive) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    intervalRef.current = setInterval(() => {
      tickTimer()
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [timerActive, tickTimer])

  useEffect(() => {
    if (timerActive && timerSeconds <= 0) {
      buzz([60, 50, 60])
      playRestChime()
      setTimer(0, false)
    }
  }, [timerActive, timerSeconds, setTimer])

  const m = Math.floor(timerSeconds / 60)
  const s = timerSeconds % 60

  return (
    <div className={`${styles.restTimer} ${timerActive ? styles.up : ''}`}>
      <div className={styles.restIn}>
        <div>
          <div className={styles.restL}>Rest</div>
          <div className={`${styles.restT} mono`}>{m}:{String(s).padStart(2, '0')}</div>
        </div>
        <button className={styles.restX} onClick={() => setTimer(0, false)}>
          Skip
        </button>
      </div>
    </div>
  )
}
