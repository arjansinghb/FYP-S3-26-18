// The main chat screen — CH03 (Start Chat Session) through CH13 (End Chat
// Session). Deliberately NOT a search box: full-screen conversation, avatar
// up top, small set of recommendation cards inline, one clarifying question
// at a time. See agent-context/CLAUDE.md §2.1/§9 for the design rules this
// implements.
//
// dev-session 2026-08-21 redesign: a teammate testing the app said "the
// Chatbot is supposed to be like an avatar not text based" — the avatar was
// a small 50px icon in the header, easy to miss, with no visual reaction to
// anything. This adds a large "companion" avatar (ChildApp's real character
// art, see avatars.tsx) with three visual states — idle (gentle bob),
// thinking (while waiting on a reply), speaking (while text-to-speech is
// playing) — and extends CH11 (Listen, previously scoped to just
// recommendation cards) to narrate the bot's own conversational lines too,
// via a shared useSpeech() hook so the avatar's state and every "the bot is
// talking" moment stay in sync. Text chat and the transcript are still here
// underneath — the URS's own CH06 describes text *and* voice input, this
// isn't replacing one with the other, just giving the avatar an actual
// presence instead of a corner icon.
import { useEffect, useRef, useState } from 'react'
import { ApiError, endSession, requestAlternative, sendMessage, startSession } from '../api/client'
import { getAvatar } from '../avatars'
import { CompassIcon, FlameIcon, FlaskIcon, LaughIcon, PawIcon, SparkleIcon, StarIcon } from '../icons'
import { useSpeech } from '../state/useSpeech'
import type { ChildProfilePublic } from '../types'
import ChatBubble, { type DisplayMessage } from './ChatBubble'

interface Props {
  token: string
  profile: ChildProfilePublic
  onLogout: () => void
  onEditAvatar: () => void
  onShowFavourites: () => void
}

// dev-session 2026-08-21 — quick-start chips. Tapping one sends it exactly
// like typing would; lowers the barrier for a child who isn't a confident
// typist yet, and nudges toward variety beyond the two seed prompts
// ("book" or "video"). Icon components, not emoji — see icons.tsx's module
// docstring for why.
const STARTER_PROMPTS = [
  { Icon: LaughIcon, label: 'Something funny', text: 'Show me something funny' },
  { Icon: PawIcon, label: 'Animals', text: 'I want something about animals' },
  { Icon: CompassIcon, label: 'An adventure', text: 'I want an adventure story' },
  { Icon: FlaskIcon, label: 'Science', text: 'Show me something about science' },
  { Icon: SparkleIcon, label: 'Surprise me', text: 'Surprise me with anything' },
]

let messageCounter = 0
function nextId() {
  messageCounter += 1
  return `local-${messageCounter}`
}

const GREETING = "Hi! What are you in the mood for today — a book or a video?"

export default function ChatScreen({ token, profile, onLogout, onEditAvatar, onShowFavourites }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [altLoading, setAltLoading] = useState(false)
  const [ended, setEnded] = useState(false)
  const [listening, setListening] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const avatar = getAvatar(profile.avatar_id)
  const { speak, stop, speaking, supported: hasVoiceOutput } = useSpeech()

  useEffect(() => {
    let cancelled = false
    startSession(profile.id, token).then((session) => {
      if (cancelled) return
      setSessionId(session.id)
      setMessages([{ id: nextId(), sender: 'bot', text: GREETING }])
      if (autoSpeak) speak(GREETING)
    })
    return () => {
      cancelled = true
    }
    // Only ever run once per session start — autoSpeak/speak deliberately
    // excluded so toggling the mute button mid-session doesn't retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Stop any in-progress narration on unmount (e.g. child logs out mid-sentence).
  useEffect(() => stop, [stop])

  async function handleSend(override?: string) {
    const text = (override ?? input).trim()
    if (!text || !sessionId || sending) return
    setInput('')
    setMessages((prev) => [...prev, { id: nextId(), sender: 'child', text }])
    setSending(true)
    try {
      const reply = await sendMessage(sessionId, token, text)
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          sender: 'bot',
          text: reply.message,
          recommendations: reply.recommendations,
          canShowAlternative: reply.recommendations.length > 0,
        },
      ])
      if (autoSpeak) speak(reply.message)
    } catch (err) {
      const text = err instanceof ApiError ? err.message : "Hmm, I couldn't hear that — try again?"
      setMessages((prev) => [...prev, { id: nextId(), sender: 'bot', text }])
      if (autoSpeak) speak(text)
    } finally {
      setSending(false)
    }
  }

  async function handleAlternative() {
    if (!sessionId || altLoading) return
    setAltLoading(true)
    try {
      const reply = await requestAlternative(sessionId, token)
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          sender: 'bot',
          text: reply.message,
          recommendations: reply.recommendations,
          canShowAlternative: reply.recommendations.length > 0,
        },
      ])
      if (autoSpeak) speak(reply.message)
    } finally {
      setAltLoading(false)
    }
  }

  async function handleEndSession() {
    if (!sessionId) return
    stop()
    await endSession(sessionId, token)
    setEnded(true)
  }

  function handleMic() {
    type SpeechRecognitionCtor = new () => {
      lang: string
      onresult: (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void
      onend: () => void
      start: () => void
    }
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor
      webkitSpeechRecognition?: SpeechRecognitionCtor
    }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.lang = 'en-US'
    recognition.onresult = (e) => setInput(e.results[0][0].transcript)
    recognition.onend = () => setListening(false)
    setListening(true)
    recognition.start()
  }

  if (ended) {
    return (
      <div className="screen">
        <div className="bubble-avatar bubble-avatar--big" style={{ background: avatar.color }}>
          {avatar.icon}
        </div>
        <h2 className="login-subtitle">See you next time, {profile.name}!</h2>
        <button className="big-button" onClick={onLogout}>
          Log out
        </button>
      </div>
    )
  }

  const hasVoiceInput =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const companionState = sending ? 'thinking' : speaking ? 'speaking' : 'idle'

  return (
    <div className="chat-screen">
      <header className="chat-header">
        <button className="avatar-button" style={{ background: avatar.color }} onClick={onEditAvatar}>
          {avatar.icon}
        </button>
        <div className="chat-header-name">
          {profile.name}
          {/* dev-session 2026-08-21 — engagement streak, not shown at all
              until there's something to show (a first-ever login is still
              day 1, not worth a badge yet). */}
          {profile.current_streak > 1 && (
            <span className="streak-badge" title={`Longest streak: ${profile.longest_streak} day${profile.longest_streak === 1 ? '' : 's'}`}>
              <FlameIcon /> {profile.current_streak}
            </span>
          )}
        </div>
        <div className="chat-header-actions">
          <button className="link-button" onClick={onShowFavourites}>
            <StarIcon /> My Favourites
          </button>
          {hasVoiceOutput && (
            <button
              className="link-button"
              onClick={() => {
                if (autoSpeak) stop()
                setAutoSpeak((v) => !v)
              }}
              aria-label={autoSpeak ? 'Mute avatar voice' : 'Unmute avatar voice'}
            >
              {autoSpeak ? '🔊' : '🔇'}
            </button>
          )}
          <button className="link-button" onClick={handleEndSession}>
            Done for today
          </button>
          <button className="link-button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      <div className={`chat-companion chat-companion--${companionState}`}>
        {/* dev-session 2026-08-21: no background colour/ring here on purpose
            — just the character's face, per Kiefer's ask. Small avatar
            badges elsewhere (header, bubbles, cards, picker) still carry
            avatar.color. */}
        <div className="companion-avatar">{avatar.icon}</div>
        {companionState === 'thinking' && (
          <div className="companion-status companion-status--thinking">
            <span />
            <span />
            <span />
          </div>
        )}
        {companionState === 'speaking' && <div className="companion-status companion-status--speaking">Talking…</div>}
      </div>

      {/* dev-session 2026-08-21 — quick-start chips. Only before the child's
          first real message (messages.length is 1 = just the greeting) so
          they don't clutter an actual conversation in progress. */}
      {messages.length === 1 && !sending && (
        <div className="starter-chips">
          {STARTER_PROMPTS.map((p) => (
            <button key={p.label} className="starter-chip" onClick={() => handleSend(p.text)}>
              <p.Icon /> {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((m) => (
          <ChatBubble
            key={m.id}
            message={m}
            avatarId={profile.avatar_id}
            childId={profile.id}
            token={token}
            onRequestAlternative={handleAlternative}
            alternativeLoading={altLoading}
            onSpeak={speak}
            canSpeak={hasVoiceOutput}
          />
        ))}
        {sending && (
          <div className="bubble-row bubble-row--bot">
            <div className="bubble-avatar" style={{ background: avatar.color }}>
              {avatar.icon}
            </div>
            <div className="bubble bubble--bot bubble--typing">…</div>
          </div>
        )}
      </div>

      <div className="chat-input-row">
        <input
          className="text-input chat-text-input"
          placeholder="Tell me what you're looking for…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          disabled={!sessionId || sending}
        />
        {hasVoiceInput && (
          <button className={`mic-button ${listening ? 'mic-button--active' : ''}`} onClick={handleMic}>
            🎤
          </button>
        )}
        <button className="send-button" onClick={() => handleSend()} disabled={!sessionId || sending || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}
