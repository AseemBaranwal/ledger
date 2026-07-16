import { useEffect, useRef } from 'react'
import { useUIStore } from '@/store'
import styles from '../../styles/components.module.css'

function playTimerSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 800
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)
  } catch (e) {
    // ignore
  }
}

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
      playTimerSound()
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
