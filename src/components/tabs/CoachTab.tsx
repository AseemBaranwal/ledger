import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useUIStore } from '@/store'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

const QUICK_PROMPTS = [
  "How's my training looking this week?",
  'Any weight suggestions for my next session?',
  "What's the trend on my squat?",
]

export function CoachTab() {
  const messages = useChatStore((s) => s.messages)
  const sending = useChatStore((s) => s.sending)
  const lastUsage = useChatStore((s) => s.lastUsage)
  const error = useChatStore((s) => s.error)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const acceptSuggestion = useChatStore((s) => s.acceptSuggestion)
  const dismissSuggestion = useChatStore((s) => s.dismissSuggestion)
  const clearError = useChatStore((s) => s.clearError)
  const showNotification = useUIStore((s) => s.showNotification)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  useEffect(() => {
    if (error) {
      showNotification(error, 'error')
      clearError()
    }
  }, [error, showNotification, clearError])

  const handleSend = (text?: string) => {
    const toSend = text ?? input
    if (!toSend.trim() || sending) return
    sendMessage(toSend)
    setInput('')
  }

  return (
    <div>
      <div className={appStyles.hero}>
        <div className={appStyles.eyebrow}>Ask about your training</div>
        <h1>Coach</h1>
        {lastUsage && (
          <div className={appStyles.heroSub}>
            {lastUsage.dailyUsed} of {lastUsage.dailyLimit} messages today
          </div>
        )}
      </div>

      {messages.length === 0 && (
        <div className={styles.card} style={{ padding: '14px' }}>
          <div className={styles.note} style={{ marginBottom: '10px' }}>
            Ask about trends, PRs, or what to lift next — grounded in your actual logged data.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                className={`${styles.btn} ${styles.ghost}`}
                onClick={() => handleSend(prompt)}
                disabled={sending}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
        {messages.map((message) => (
          <div key={message.id} style={{ display: 'flex', justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div
              style={{
                maxWidth: '85%',
                borderRadius: 'var(--r)',
                padding: '10px 13px',
                fontSize: '13.5px',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                background: message.role === 'user' ? 'var(--amber)' : 'var(--surface)',
                color: message.role === 'user' ? '#14181D' : 'var(--text)',
                border: message.role === 'user' ? 'none' : '1px solid var(--line)',
              }}
            >
              {message.content}

              {message.suggestions?.map((suggestion, i) => (
                <SuggestionCard
                  key={i}
                  suggestion={suggestion}
                  onAccept={(weight) => acceptSuggestion(message.id, i, weight)}
                  onDismiss={() => dismissSuggestion(message.id, i)}
                />
              ))}
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div
              style={{
                borderRadius: 'var(--r)',
                padding: '10px 13px',
                fontSize: '13.5px',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                color: 'var(--dim)',
              }}
            >
              Thinking…
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <textarea
          className={styles.notes}
          style={{ minHeight: '44px', flex: 1 }}
          placeholder="Ask your coach…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <button
          className={`${styles.btn} ${styles.primary}`}
          style={{ width: 'auto', padding: '0 18px' }}
          onClick={() => handleSend()}
          disabled={sending || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}

interface SuggestionCardProps {
  suggestion: { exerciseCode: string; exerciseName: string; currentWeight: number; suggestedWeight: number; reasoning: string; status: 'pending' | 'accepted' | 'dismissed' }
  onAccept: (weight: number) => void
  onDismiss: () => void
}

function SuggestionCard({ suggestion, onAccept, onDismiss }: SuggestionCardProps) {
  const [weight, setWeight] = useState(suggestion.suggestedWeight)

  return (
    <div
      style={{
        marginTop: '10px',
        background: 'var(--raised)',
        border: '1px solid var(--line-2)',
        borderRadius: '10px',
        padding: '11px 12px',
        color: 'var(--text)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{suggestion.exerciseName}</div>
      <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginBottom: '8px' }}>{suggestion.reasoning}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'JetBrains Mono', fontSize: '13px', marginBottom: '10px' }}>
        <span style={{ color: 'var(--dim)' }}>{suggestion.currentWeight} lb</span>
        <span style={{ color: 'var(--dim)' }}>→</span>
        <input
          type="number"
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value) || 0)}
          disabled={suggestion.status !== 'pending'}
          style={{
            width: '70px',
            background: 'var(--surface)',
            border: '1px solid var(--line-2)',
            borderRadius: '8px',
            padding: '6px 8px',
            color: 'var(--amber)',
            fontFamily: 'JetBrains Mono',
            fontWeight: 700,
            fontSize: '13px',
          }}
        />
        <span style={{ color: 'var(--dim)' }}>lb</span>
      </div>

      {suggestion.status === 'pending' && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className={`${styles.btn} ${styles.primary}`} style={{ minHeight: '38px', fontSize: '13px' }} onClick={() => onAccept(weight)}>
            Accept
          </button>
          <button className={`${styles.btn} ${styles.quiet}`} style={{ minHeight: '38px' }} onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
      {suggestion.status === 'accepted' && <div style={{ fontSize: '12px', color: 'var(--teal)' }}>Sent to your sheet.</div>}
      {suggestion.status === 'dismissed' && <div style={{ fontSize: '12px', color: 'var(--dim)' }}>Dismissed.</div>}
    </div>
  )
}
