import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar, { AVATAR_COLORS } from '../components/Avatar'
import RecommendationCard from '../components/RecommendationCard'
import ChildLogin from './ChildLogin'
import {
  askPip, getChildToken, getChildMe, childLogout, setChildAvatar,
  saveFavourite, myFavourites, sendFeedback, startChatSession, endChatSession,
} from '../api'
import { getReply } from '../placeholderBot'
import '../App.css'
import './child.css'

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

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
  const [caption, setCaption] = useState(`Hi ${child.name}! Tap the mic or type below to tell me what you'd like to read or watch!`)
  const [recs, setRecs] = useState([])
  const [lastMessage, setLastMessage] = useState('')
  const [overlay, setOverlay] = useState(null)   // 'favourites' | 'avatar' | null
  const [favs, setFavs] = useState([])
  const [details, setDetails] = useState(null)   // a rec item
  const [video, setVideo] = useState(null)       // a rec item
  const [typed, setTyped] = useState('')
  const [sessionId, setSessionId] = useState(null)  // CH04 — ties messages together for real conversation memory (CH07)
  const recognitionRef = useRef(null)

  // CH04 — a chat session starts once, when the child reaches this screen
  // (already-logged-in trigger, per the URS). Its id rides along on every
  // message so the backend can hand the brain real prior-turn context.
  useEffect(() => {
    let cancelled = false
    startChatSession().then((s) => { if (!cancelled) setSessionId(s.id) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // CH05 — ends the session on logout ("before handing back a shared
  // device") rather than leaving it open forever.
  function logoutAndEndSession() {
    if (sessionId) endChatSession(sessionId).catch(() => {})
    onLogout()
  }

  const supported = Boolean(SpeechRecognition) && 'speechSynthesis' in window
  const color = child.avatar in AVATAR_COLORS ? child.avatar : 'purple'

  function speak(text) {
    setCaption(text)
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
    setStatus('thinking')
    setCaption('Hmm, let me think…')
    setLastMessage(message)
    try {
      const res = await askPip(message, sessionId)
      setRecs(res.recommendations || [])
      speak(res.reply)
    } catch {
      setRecs([])
      speak(getReply(message))
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

    rec.onstart = () => { setStatus('listening'); setCaption("Listening… I'm all ears!") }
    rec.onresult = (e) => ask(e.results[0][0].transcript)
    rec.onerror = (e) => {
      setStatus('idle')
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setCaption('I need permission to use the microphone. Please allow it, then tap again!')
      } else if (e.error === 'no-speech') {
        setCaption("I didn't quite hear that. Tap the button and try again!")
      } else {
        setCaption('Oops! Something went wrong. Tap the button to try again.')
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
  const buttonLabel = listening ? 'Listening… tap to stop'
    : status === 'thinking' ? 'Thinking…'
    : status === 'speaking' ? 'Pip is talking…'
    : 'Tap to talk'

  return (
    <div>
      <div className="child-bar">
        <span className="who">Hi, {child.name}!</span>
        <div className="bar-btns">
          <button className="pill" onClick={openFavourites}>❤️ Favourites</button>
          <button className="pill" onClick={() => setOverlay('avatar')}>🎨 Avatar</button>
          <button className="pill" onClick={logoutAndEndSession}>Log out</button>
        </div>
      </div>

      <div className="app">
        <div className="stage">
          <Avatar speaking={speaking} mood={speaking ? 'idle' : 'happy'} color={color} />
          <p className={`caption ${listening ? 'caption-listening' : ''}`}>{caption}</p>

          {supported ? (
            <button
              className={`talk ${listening ? 'talk-listening' : ''}`}
              onClick={startListening}
              disabled={status === 'thinking' || status === 'speaking'}
            >
              <span className="talk-icon" aria-hidden="true">🎤</span>
              <span>{buttonLabel}</span>
            </button>
          ) : (
            <p className="caption">This browser can't listen for talking — no worries, you can still type below! 😊</p>
          )}

          {supported && <p className="or-divider">or type instead</p>}

          <form className="type-row" onSubmit={submitTyped}>
            <input
              type="text"
              className="type-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type what you'd like to read or watch…"
              disabled={status === 'thinking' || status === 'speaking'}
              aria-label="Type a message to Pip"
            />
            <button
              type="submit"
              className="type-send"
              disabled={!typed.trim() || status === 'thinking' || status === 'speaking'}
            >
              Send
            </button>
          </form>
        </div>
      </div>

      {recs.length > 0 && (
        <>
          <div className="recs">
            {recs.map((item) => (
              <RecommendationCard
                key={item.id}
                item={item}
                onDetails={setDetails}
                onWatch={setVideo}
                onSave={(it) => saveFavourite(it.id).catch(() => {})}
                onFeedback={(it, liked) => sendFeedback(it.id, liked).catch(() => {})}
              />
            ))}
          </div>
          <div style={{ textAlign: 'center', margin: '14px 0 30px' }}>
            <button className="pill" onClick={() => ask(lastMessage)}>🔄 Show me another</button>
          </div>
        </>
      )}

      {/* CH16 — favourites */}
      {overlay === 'favourites' && (
        <Overlay title="My Favourites" onClose={() => setOverlay(null)}>
          {favs.length === 0 && <p className="muted">You haven't saved anything yet. Tap 🤍 Save on a suggestion!</p>}
          {favs.map((f) => (
            <div key={f.id} className="fav-row">{f.type === 'book' ? '📚' : '🎬'} {f.title}</div>
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
        <Overlay title={`${details.type === 'book' ? '📚' : '🎬'} ${details.title}`} onClose={() => setDetails(null)}>
          {details.thumbnail && <img className="rec-cover" src={details.thumbnail} alt="" />}
          <p>{details.description || details.explanation}</p>
          <p className="muted">Why Pip picked it: {details.explanation}</p>
        </Overlay>
      )}

      {/* CH12 — watch embedded video */}
      {video && (
        <Overlay title={`🎬 ${video.title}`} onClose={() => setVideo(null)}>
          <div className="video-box">
            {video.external_ref ? (
              <iframe
                src={`https://www.youtube.com/embed/${video.external_ref}`}
                title={video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <span>▶ This is where the video plays.<br />(Sample catalogue — real, curated videos get linked in later.)</span>
            )}
          </div>
        </Overlay>
      )}
    </div>
  )
}

function Overlay({ title, children, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="pill close" onClick={onClose}>Close ✕</button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
