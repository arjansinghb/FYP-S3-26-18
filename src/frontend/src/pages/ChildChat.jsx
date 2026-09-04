import { useEffect, useRef, useState } from 'react'
import Avatar, { AVATAR_COLORS } from '../components/Avatar'
import RecommendationCard from '../components/RecommendationCard'
import ChildLogin from './ChildLogin'
import {
  askPip, getChildToken, getChildMe, childLogout, setChildAvatar,
  saveFavourite, myFavourites, sendFeedback, startChatSession, endChatSession,
} from '../api'
import { getReply } from '../placeholderBot'
import {
  BookIcon, CloseIcon, CompassIcon, HeartIcon, LogoutIcon, MicIcon, MoonIcon,
  PaletteIcon, PawIcon, RefreshIcon, SendIcon, SparkleIcon, VideoIcon,
} from '../icons'
import '../App.css'
import './child.css'

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

// A handful of ready-made openers so a child who isn't a confident typer (or
// just doesn't know where to start) has a one-tap way in — shown only before
// the first real message, so they don't clutter an in-progress conversation.
const STARTER_PROMPTS = [
  { icon: SparkleIcon, label: 'Surprise me', message: 'Surprise me with something fun!' },
  { icon: BookIcon, label: 'A good book', message: "I'd like a good book to read." },
  { icon: VideoIcon, label: 'A fun video', message: "I'd like to watch something fun." },
  { icon: PawIcon, label: 'Animal stories', message: 'Do you have anything about animals?' },
  { icon: CompassIcon, label: 'Adventure', message: 'I want something exciting and adventurous.' },
  { icon: MoonIcon, label: 'Something calm', message: 'I want something calm and cosy.' },
]

function newId() {
  return Math.random().toString(36).slice(2)
}

// Session gate: restore a logged-in child, else show the login screen.
export default function ChildChat() {
  const [child, setChild] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getChildToken()) { setLoading(false); return }
    getChildMe().then(setChild).catch(() => childLogout()).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="child-login"><p className="muted">Loading…</p></div>
  if (!child) return <ChildLogin onLoggedIn={setChild} />
  return <Experience child={child} setChild={setChild} onLogout={() => { childLogout(); setChild(null) }} />
}

function Experience({ child, setChild, onLogout }) {
  const [status, setStatus] = useState('idle') // idle | listening | thinking | speaking
  // The visible transcript IS the context window (see storage.session_history
  // on the backend) — every turn shown here is exactly what gets sent back to
  // the brain as conversation memory, nothing hidden or summarised away.
  const [turns, setTurns] = useState([
    { id: 'greeting', role: 'pip', text: `Hi ${child.name}! Tap the mic or type below to tell me what you'd like to read or watch.` },
  ])
  const [overlay, setOverlay] = useState(null)   // 'favourites' | 'avatar' | null
  const [favs, setFavs] = useState([])
  const [details, setDetails] = useState(null)   // a rec item
  const [video, setVideo] = useState(null)       // a rec item
  const [typed, setTyped] = useState('')
  const [sessionId, setSessionId] = useState(null)  // CH04 — ties messages together for real conversation memory (CH07)
  const recognitionRef = useRef(null)
  const transcriptEndRef = useRef(null)

  const hasChatted = turns.some((t) => t.role === 'child')

  // CH04 — a chat session starts once, when the child reaches this screen
  // (already-logged-in trigger, per the URS). Its id rides along on every
  // message so the backend can hand the brain real prior-turn context.
  useEffect(() => {
    let cancelled = false
    startChatSession().then((s) => { if (!cancelled) setSessionId(s.id) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // 'auto' (instant), not 'smooth' — smooth scroll is a requestAnimationFrame
    // animation, which browsers throttle/skip in a backgrounded tab, so a
    // child switching apps mid-reply could come back to the reply scrolled
    // out of view. Instant scroll is a synchronous position set, not subject
    // to that — reliability here matters more than the animation.
    transcriptEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [turns])

  // CH05 — ends the session on logout ("before handing back a shared
  // device") rather than leaving it open forever.
  function logoutAndEndSession() {
    if (sessionId) endChatSession(sessionId).catch(() => {})
    onLogout()
  }

  const supported = Boolean(SpeechRecognition) && 'speechSynthesis' in window
  const color = child.avatar in AVATAR_COLORS ? child.avatar : 'purple'

  function speak(text) {
    if (!('speechSynthesis' in window)) { setStatus('idle'); return }
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.95
    u.pitch = 1.25
    const voices = window.speechSynthesis.getVoices()
    const preferred =
      voices.find((v) => /^en/i.test(v.lang) && /female|zira|hazel|susan|samantha|aria|jenny/i.test(v.name)) ||
      voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('en'))
    if (preferred) u.voice = preferred
    u.onstart = () => setStatus('speaking')
    u.onend = () => setStatus('idle')
    u.onerror = () => setStatus('idle')
    window.speechSynthesis.speak(u)
  }

  async function ask(message) {
    if (!message) return
    const pipId = newId()
    setStatus('thinking')
    setTurns((t) => [
      ...t,
      { id: newId(), role: 'child', text: message },
      { id: pipId, role: 'pip', text: null, pending: true, sourceMessage: message },
    ])
    try {
      const res = await askPip(message, sessionId)
      setTurns((t) => t.map((turn) => (
        turn.id === pipId ? { ...turn, text: res.reply, recs: res.recommendations || [], pending: false } : turn
      )))
      speak(res.reply)
    } catch {
      const fallback = getReply(message)
      setTurns((t) => t.map((turn) => (
        turn.id === pipId ? { ...turn, text: fallback, recs: [], pending: false } : turn
      )))
      speak(fallback)
    }
  }

  function startListening() {
    if (!SpeechRecognition || status === 'thinking' || status === 'speaking') return
    if (status === 'listening') { recognitionRef.current?.stop(); return }
    window.speechSynthesis?.cancel()

    const rec = new SpeechRecognition()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1
    recognitionRef.current = rec

    rec.onstart = () => setStatus('listening')
    rec.onresult = (e) => ask(e.results[0][0].transcript)
    rec.onerror = (e) => {
      setStatus('idle')
      if (e.error !== 'not-allowed' && e.error !== 'service-not-allowed' && e.error !== 'no-speech') {
        setTurns((t) => [...t, { id: newId(), role: 'pip', text: 'Oops! Something went wrong. Tap the mic to try again.' }])
      }
    }
    rec.onend = () => setStatus((s) => (s === 'listening' ? 'idle' : s))
    rec.start()
  }

  function submitTyped(e) {
    e.preventDefault()
    const message = typed.trim()
    if (!message) return
    setTyped('')
    recognitionRef.current?.stop?.()
    ask(message)
  }

  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices()
    }
    return () => { window.speechSynthesis?.cancel(); recognitionRef.current?.abort?.() }
  }, [])

  async function openFavourites() {
    setOverlay('favourites')
    try { setFavs(await myFavourites()) } catch { setFavs([]) }
  }

  async function pickAvatar(key) {
    try {
      await setChildAvatar(key)
      setChild({ ...child, avatar: key })
    } catch { /* ignore */ }
  }

  const speaking = status === 'speaking'
  const listening = status === 'listening'
  const busy = status === 'thinking' || status === 'speaking'
  const statusLine = listening ? "Listening… I'm all ears!"
    : status === 'thinking' ? 'Thinking…'
    : status === 'speaking' ? 'Talking…'
    : null

  return (
    <div className="child-screen">
      <div className="child-bar">
        <span className="who">Hi, {child.name}!</span>
        <div className="bar-btns">
          <button className="pill" onClick={openFavourites}><HeartIcon width={16} height={16} /> Favourites</button>
          <button className="pill" onClick={() => setOverlay('avatar')}><PaletteIcon width={16} height={16} /> Avatar</button>
          <button className="pill" onClick={logoutAndEndSession}><LogoutIcon width={16} height={16} /> Log out</button>
        </div>
      </div>

      <div className="chat-shell">
        <div className="chat-presence">
          <div className="chat-presence-glow" />
          <Avatar speaking={speaking} mood={speaking ? 'idle' : 'happy'} color={color} />
          <p className={`chat-status ${listening ? 'chat-status-listening' : ''}`}>{statusLine || ' '}</p>
        </div>

        <div className="chat-transcript">
          {turns.map((turn) => (
            <div key={turn.id} className={`bubble-row bubble-row-${turn.role}`}>
              <div className={`bubble bubble-${turn.role}`}>
                {turn.pending ? (
                  <span className="bubble-dots" aria-label="Pip is thinking">
                    <span></span><span></span><span></span>
                  </span>
                ) : turn.text}
              </div>

              {turn.recs?.length > 0 && (
                <div className="bubble-recs">
                  {turn.recs.map((item) => (
                    <RecommendationCard
                      key={item.id}
                      item={item}
                      onDetails={setDetails}
                      onWatch={setVideo}
                      onSave={(it) => saveFavourite(it.id).catch(() => {})}
                      onFeedback={(it, liked) => sendFeedback(it.id, liked).catch(() => {})}
                    />
                  ))}
                  <button className="pill" onClick={() => ask(turn.sourceMessage)}>
                    <RefreshIcon width={15} height={15} /> Show me another
                  </button>
                </div>
              )}
            </div>
          ))}

          {!hasChatted && (
            <div className="starter-row">
              {STARTER_PROMPTS.map(({ icon: Icon, label, message }) => (
                <button key={label} className="starter-chip" onClick={() => ask(message)}>
                  <Icon width={17} height={17} />
                  {label}
                </button>
              ))}
            </div>
          )}

          <div ref={transcriptEndRef} />
        </div>
      </div>

      {/* Own full-width surface, sibling of .chat-shell (not nested inside
          its capped max-width) — see App.css's .chat-input-bar. */}
      <form className="chat-input-bar" onSubmit={submitTyped}>
        {supported && (
          <button
            type="button"
            className={`mic-btn ${listening ? 'mic-btn-listening' : ''}`}
            onClick={startListening}
            disabled={status === 'thinking' || status === 'speaking'}
            aria-label={listening ? 'Stop listening' : 'Talk to Pip'}
            title={listening ? 'Stop listening' : 'Talk to Pip'}
          >
            <MicIcon />
          </button>
        )}
        <input
          type="text"
          className="chat-text-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={supported ? 'Type or tap the mic…' : "This browser can't listen — type here instead"}
          disabled={busy}
          aria-label="Type a message to Pip"
        />
        <button type="submit" className="chat-send-btn" disabled={!typed.trim() || busy} aria-label="Send">
          <SendIcon width={18} height={18} />
        </button>
      </form>

      {/* CH16 — favourites */}
      {overlay === 'favourites' && (
        <Overlay title="My Favourites" onClose={() => setOverlay(null)}>
          {favs.length === 0 && <p className="muted">You haven't saved anything yet. Tap Save on a suggestion!</p>}
          {favs.map((f) => (
            <div key={f.id} className="fav-row">
              {f.type === 'book' ? <BookIcon width={17} height={17} /> : <VideoIcon width={17} height={17} />} {f.title}
            </div>
          ))}
        </Overlay>
      )}

      {/* CH19/CH20 — choose / edit avatar */}
      {overlay === 'avatar' && (
        <Overlay title="Choose your buddy's colour" onClose={() => setOverlay(null)}>
          <div style={{ textAlign: 'center' }}>
            <Avatar speaking={false} mood="happy" color={color} />
          </div>
          <div className="swatches">
            {Object.keys(AVATAR_COLORS).map((key) => (
              <button
                key={key}
                className={`swatch ${key === color ? 'sel' : ''}`}
                style={{ background: AVATAR_COLORS[key] }}
                onClick={() => pickAvatar(key)}
                aria-label={key}
              />
            ))}
          </div>
        </Overlay>
      )}

      {/* CH14 — content details */}
      {details && (
        <Overlay title={details.title} icon={details.type === 'book' ? BookIcon : VideoIcon} onClose={() => setDetails(null)}>
          {details.thumbnail && <img className="rec-cover" src={details.thumbnail} alt="" />}
          <p>{details.description || details.explanation}</p>
          <p className="muted">Why Pip picked it: {details.explanation}</p>
        </Overlay>
      )}

      {/* CH12 — watch embedded video */}
      {video && (
        <Overlay title={video.title} icon={VideoIcon} onClose={() => setVideo(null)}>
          <div className="video-box">
            {video.external_ref ? (
              <iframe
                src={`https://www.youtube.com/embed/${video.external_ref}`}
                title={video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <span>This is where the video plays.<br />(Sample catalogue — real, curated videos get linked in later.)</span>
            )}
          </div>
        </Overlay>
      )}
    </div>
  )
}

function Overlay({ title, icon: Icon, children, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="pill close" onClick={onClose} aria-label="Close"><CloseIcon width={16} height={16} /></button>
        <h2>{Icon && <Icon width={20} height={20} />} {title}</h2>
        {children}
      </div>
    </div>
  )
}
