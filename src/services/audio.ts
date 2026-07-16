// Mobile browsers (iOS Safari especially) only let a freshly-created
// AudioContext produce sound if it's created/resumed inside a direct user
// gesture (a click/tap handler). Creating a new context later — e.g. from a
// setInterval callback when a rest timer expires — gets silently suspended.
// So we create ONE context, unlocked the first time a user taps anything,
// and reuse it for every subsequent chime.
let ctx: AudioContext | null = null

export function unlockAudioContext() {
  const Ctx = window.AudioContext || (window as any).webkitAudioContext
  if (!Ctx) return
  if (!ctx) ctx = new Ctx()
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
}

export function playRestChime() {
  if (!ctx) return
  try {
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
