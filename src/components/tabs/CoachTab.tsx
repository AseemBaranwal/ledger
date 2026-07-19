import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { useChatStore } from '@/store/chatStore'
import { useUIStore, useSessionStore } from '@/store'
import { estimateCostUsd, formatTokenCount, formatCostUsd } from '@/services/chatCost'
import type { ChatSuggestion, ExerciseChange } from '@/services/chat'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

// Compact block spacing for a narrow chat bubble — the default browser
// margins on p/ul/ol read as way too loose at this width. No headers/tables
// since the system prompt tells the model not to use them here.
const markdownComponents: Components = {
  p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: '18px' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: '18px' }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: '2px' }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
  code: ({ children }) => (
    <code style={{ background: 'var(--raised)', borderRadius: '4px', padding: '1px 5px', fontSize: '0.92em' }}>{children}</code>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--amber)' }}>
      {children}
    </a>
  ),
}

const QUICK_PROMPTS = [
  "How's my training looking this week?",
  'Any weight suggestions for my next session?',
  "What's the trend on my squat?",
]

export function CoachTab() {
  const messages = useChatStore((s) => s.messages)
  const sending = useChatStore((s) => s.sending)
  const statusMessage = useChatStore((s) => s.statusMessage)
  const lastUsage = useChatStore((s) => s.lastUsage)
  const error = useChatStore((s) => s.error)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const loadHistory = useChatStore((s) => s.loadHistory)
  const deleteExchange = useChatStore((s) => s.deleteExchange)
  const acceptSuggestion = useChatStore((s) => s.acceptSuggestion)
  const acceptSwap = useChatStore((s) => s.acceptSwap)
  const dismissSuggestion = useChatStore((s) => s.dismissSuggestion)
  const clearError = useChatStore((s) => s.clearError)
  const showNotification = useUIStore((s) => s.showNotification)
  const draftDefs = useSessionStore((s) => s.draftDefs)

  const [input, setInput] = useState('')
  const [revealedId, setRevealedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<number | null>(null)

  const startLongPress = (id: string) => {
    longPressTimer.current = window.setTimeout(() => setRevealedId(id), 450)
  }
  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  // Refresh from the server's durable copy every time the tab opens, so a
  // reload or a different device shows the real conversation, not just
  // whatever this browser cached locally.
  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending, statusMessage])

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

  const dailyTokens = lastUsage
    ? lastUsage.dailyInputTokens + lastUsage.dailyOutputTokens + lastUsage.dailyCacheReadTokens + lastUsage.dailyCacheCreationTokens
    : 0
  const dailyCostUsd = lastUsage
    ? estimateCostUsd({
        inputTokens: lastUsage.dailyInputTokens,
        outputTokens: lastUsage.dailyOutputTokens,
        cacheReadTokens: lastUsage.dailyCacheReadTokens,
        cacheCreationTokens: lastUsage.dailyCacheCreationTokens,
      })
    : 0

  return (
    <div>
      <div className={appStyles.hero}>
        <div className={appStyles.eyebrow}>Ask about your training</div>
        <h1>Coach</h1>
        {lastUsage && (
          <div className={appStyles.heroSub} title="Rough estimate from published claude-sonnet-5 rates, not a billing reconciliation">
            {lastUsage.dailyUsed} of {lastUsage.dailyLimit} messages today · {formatTokenCount(dailyTokens)} tokens · {formatCostUsd(dailyCostUsd)}
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
          <div
            key={message.id}
            className={styles.msgRow}
            style={{ justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start' }}
          >
            {message.role === 'user' && (
              <button
                onClick={() => {
                  deleteExchange(message.id)
                  setRevealedId(null)
                }}
                title="Delete this exchange — it won't be sent as context again"
                className={`${styles.deleteBtn} ${revealedId === message.id ? styles.revealed : ''}`}
              >
                ×
              </button>
            )}
            <div
              onTouchStart={() => message.role === 'user' && startLongPress(message.id)}
              onTouchEnd={cancelLongPress}
              onTouchMove={cancelLongPress}
              onClick={() => {
                if (message.role === 'user' && revealedId === message.id) setRevealedId(null)
              }}
              style={{
                maxWidth: '85%',
                minWidth: 0,
                borderRadius: 'var(--r)',
                padding: '10px 13px',
                fontSize: '13.5px',
                lineHeight: 1.5,
                whiteSpace: message.role === 'user' ? 'pre-wrap' : 'normal',
                background: message.role === 'user' ? 'var(--amber)' : 'var(--surface)',
                color: message.role === 'user' ? '#14181D' : 'var(--text)',
                border: message.role === 'user' ? 'none' : '1px solid var(--line)',
              }}
            >
              {message.role === 'assistant' ? (
                <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
              ) : (
                message.content
              )}

              {message.suggestions?.map((suggestion, i) =>
                (suggestion.kind ?? 'adjustment') === 'swap' ? (
                  <SwapSuggestionCard
                    key={i}
                    suggestion={suggestion}
                    canApply={!!draftDefs?.some((d) => d.k === suggestion.exerciseCode)}
                    onAccept={() => acceptSwap(message.id, i)}
                    onDismiss={() => dismissSuggestion(message.id, i)}
                  />
                ) : (
                  <AdjustmentSuggestionCard
                    key={i}
                    suggestion={suggestion}
                    onAccept={(changes) => acceptSuggestion(message.id, i, changes)}
                    onDismiss={() => dismissSuggestion(message.id, i)}
                  />
                )
              )}
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
              {statusMessage || 'Thinking…'}
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

type DisplaySuggestion = ChatSuggestion & { status: 'pending' | 'accepted' | 'dismissed' }

const cardStyle: CSSProperties = {
  marginTop: '10px',
  background: 'var(--raised)',
  border: '1px solid var(--line-2)',
  borderRadius: '10px',
  padding: '11px 12px',
  color: 'var(--text)',
}

function FieldRow({
  label,
  current,
  value,
  onChange,
  unit,
  disabled,
}: {
  label: string
  current: number | undefined
  value: number
  onChange: (v: number) => void
  unit: string
  disabled: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'JetBrains Mono', fontSize: '13px', marginBottom: '8px' }}>
      <span style={{ color: 'var(--dim)', width: '44px', flex: 'none' }}>{label}</span>
      <span style={{ color: 'var(--dim)' }}>{current ?? '—'}</span>
      <span style={{ color: 'var(--dim)' }}>→</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        disabled={disabled}
        style={{
          width: '64px',
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
      <span style={{ color: 'var(--dim)' }}>{unit}</span>
    </div>
  )
}

interface AdjustmentSuggestionCardProps {
  suggestion: DisplaySuggestion
  onAccept: (changes: ExerciseChange) => void
  onDismiss: () => void
}

function AdjustmentSuggestionCard({ suggestion, onAccept, onDismiss }: AdjustmentSuggestionCardProps) {
  const [weight, setWeight] = useState(suggestion.suggestedWeight ?? 0)
  const [reps, setReps] = useState(suggestion.suggestedReps ?? 0)
  const [sets, setSets] = useState(suggestion.suggestedSets ?? 0)

  const hasWeight = suggestion.suggestedWeight != null
  const hasReps = suggestion.suggestedReps != null
  const hasSets = suggestion.suggestedSets != null
  const disabled = suggestion.status !== 'pending'

  const handleAccept = () => {
    onAccept({
      ...(hasWeight ? { weight } : {}),
      ...(hasReps ? { reps } : {}),
      ...(hasSets ? { sets } : {}),
    })
  }

  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{suggestion.exerciseName}</div>
      <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginBottom: '8px' }}>{suggestion.reasoning}</div>

      {hasWeight && <FieldRow label="weight" current={suggestion.currentWeight} value={weight} onChange={setWeight} unit="lb" disabled={disabled} />}
      {hasReps && <FieldRow label="reps" current={suggestion.currentReps} value={reps} onChange={setReps} unit="reps" disabled={disabled} />}
      {hasSets && <FieldRow label="sets" current={suggestion.currentSets} value={sets} onChange={setSets} unit="sets" disabled={disabled} />}

      {suggestion.status === 'pending' && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
          <button className={`${styles.btn} ${styles.primary}`} style={{ minHeight: '38px', fontSize: '13px' }} onClick={handleAccept}>
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

interface SwapSuggestionCardProps {
  suggestion: DisplaySuggestion
  canApply: boolean
  onAccept: () => void
  onDismiss: () => void
}

function SwapSuggestionCard({ suggestion, canApply, onAccept, onDismiss }: SwapSuggestionCardProps) {
  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span>{suggestion.exerciseName}</span>
        <span style={{ color: 'var(--dim)' }}>→</span>
        <span style={{ color: 'var(--amber)' }}>{suggestion.newExerciseName}</span>
      </div>
      <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginBottom: '10px' }}>{suggestion.reasoning}</div>

      {suggestion.status === 'pending' && canApply && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className={`${styles.btn} ${styles.primary}`} style={{ minHeight: '38px', fontSize: '13px' }} onClick={onAccept}>
            Accept
          </button>
          <button className={`${styles.btn} ${styles.quiet}`} style={{ minHeight: '38px' }} onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
      {suggestion.status === 'pending' && !canApply && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: 'var(--dim)' }}>Start today's session to apply this swap.</span>
          <button className={`${styles.btn} ${styles.quiet}`} style={{ minHeight: '32px', width: 'auto', padding: '0 12px' }} onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
      {suggestion.status === 'accepted' && <div style={{ fontSize: '12px', color: 'var(--teal)' }}>Swapped in today's session.</div>}
      {suggestion.status === 'dismissed' && <div style={{ fontSize: '12px', color: 'var(--dim)' }}>Dismissed.</div>}
    </div>
  )
}
