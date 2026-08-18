// The main chat screen — CH03 (Start Chat Session) through CH13 (End Chat
// Session). Deliberately NOT a search box: full-screen conversation, avatar
// up top, small set of recommendation cards inline, one clarifying question
// at a time. See agent-context/CLAUDE.md §2.1/§9 for the design rules this
// implements.
import { useEffect, useRef, useState } from 'react'
import { ApiError, endSession, requestAlternative, sendMessage, startSession } from '../api/client'
import { getAvatar } from '../avatars'
import type { ChildProfilePublic } from '../types'
import ChatBubble, { type DisplayMessage } from './ChatBubble'

interface Props {
  token: string
  profile: ChildProfilePublic
  onLogout: () => void
  onEditAvatar: () => void
}

let messageCounter = 0
function nextId() {
  messageCounter += 1
  return `local-${messageCounter}`
}

const GREETING = "Hi! What are you in the mood for today — a book or a video?"

export default function ChatScreen({ token, profile, onLogout, onEditAvatar }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [altLoading, setAltLoading] = useState(false)
  const [ended, setEnded] = useState(false)
  const [listening, setListening] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const avatar = getAvatar(profile.avatar_id)

  useEffect(() => {
    let cancelled = false
    startSession(profile.id, token).then((session) => {
      if (cancelled) return
      setSessionId(session.id)
      setMessages([{ id: nextId(), sender: 'bot', text: GREETING }])
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const text = input.trim()
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
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          sender: 'bot',
          text: err instanceof ApiError ? err.message : "Hmm, I couldn't hear that — try again?",
        },
      ])
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
    } finally {
      setAltLoading(false)
    }
  }

  async function handleEndSession() {
    if (!sessionId) return
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

  return (
    <div className="chat-screen">
      <header className="chat-header">
        <button className="avatar-button" style={{ background: avatar.color }} onClick={onEditAvatar}>
          {avatar.icon}
        </button>
        <div className="chat-header-name">{profile.name}</div>
        <div className="chat-header-actions">
          <button className="link-button" onClick={handleEndSession}>
            Done for today
          </button>
          <button className="link-button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

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
        <button className="send-button" onClick={handleSend} disabled={!sessionId || sending || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}
