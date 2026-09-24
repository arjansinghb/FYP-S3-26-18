import { useEffect, useId, useRef, useState } from 'react'
import Avatar, { AVATAR_COLORS } from '../components/Avatar'
import RecommendationCard from '../components/RecommendationCard'
import ChildLogin from './ChildLogin'
import {
  askPip, getChildToken, getChildMe, childLogout, setChildAvatar, getTopics,
  saveFavourite, removeFavourite, myFavourites, sendFeedback, startChatSession, endChatSession, speakPip,
  resolvedTopic, ackResolvedTopic,
} from '../api'
import { curateTitle } from '../curate'
import {
  BookIcon, ChatIcon, CloseIcon, CompassIcon, FlameIcon, FlaskIcon, HeartIcon, LogoutIcon, MicIcon, MoonIcon,
  PaletteIcon, PawIcon, SendIcon, SparkleIcon, SpeakerIcon, TrashIcon, VideoIcon,
} from '../icons'
import { recordVisit } from '../streak'
import '../App.css'
import './child.css'

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

// Two openers that aren't a "topic" (nothing in the catalogue is tagged
// "surprise me") — always shown, real topic chips fill the rest of the row.
const EVERGREEN_PROMPTS = [
  { icon: SparkleIcon, label: 'Surprise me', message: 'Surprise me with something fun!' },
  { icon: MoonIcon, label: 'Something calm', message: 'I want something calm and cosy.' },
]
// Only used if /api/chat/topics hasn't returned yet (or came back empty) —
// so the row is never sparse on first paint while the real data loads.
const FALLBACK_TOPIC_PROMPTS = [
  { icon: BookIcon, label: 'A good book', message: "I'd like a good book to read." },
  { icon: VideoIcon, label: 'A fun video', message: "I'd like to watch something fun." },
  { icon: PawIcon, label: 'Animal stories', message: 'Do you have anything about animals?' },
  { icon: CompassIcon, label: 'Adventure', message: 'I want something exciting and adventurous.' },
]
const GENRE_ICONS = {
  animals: PawIcon, nature: PawIcon,
  adventure: CompassIcon, dinosaur: CompassIcon, mystery: CompassIcon, space: CompassIcon,
  cosy: MoonIcon, calming: MoonIcon,
  science: FlaskIcon,
  funny: SparkleIcon, humor: SparkleIcon,
}
function iconForGenre(genre) {
  return GENRE_ICONS[genre.toLowerCase()] || BookIcon
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function newId() {
  return Math.random().toString(36).slice(2)
}

// Real bug found live (2026-09-09): a refresh mid-conversation wiped the
// whole visible transcript back to the opening greeting, even though the
// backend's chat session was still open — nothing client-side ever
// survived a reload. sessionStorage (not localStorage — this is "this
// browser tab's current visit", not permanent history, and should clear
// itself once the tab actually closes) caches the active session id +
// transcript per child, so a refresh (or an accidental tab reload) resumes
// exactly where the child left off instead of looking like everything got
// deleted. Cleared explicitly on logout (CH03/CH05 already ends the
// session server-side; a fresh login should start a fresh conversation).
function sessionCacheKey(childId) {
  return `pip_active_session_${childId}`
}
function loadCachedSession(childId) {
  try {
    const raw = sessionStorage.getItem(sessionCacheKey(childId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveCachedSession(childId, data) {
  try { sessionStorage.setItem(sessionCacheKey(childId), JSON.stringify(data)) } catch { /* ignore */ }
}
function clearCachedSession(childId) {
  try { sessionStorage.removeItem(sessionCacheKey(childId)) } catch { /* ignore */ }
}

// Session gate: restore a logged-in child, else show the login screen.
export default function ChildChat() {
  const [child, setChild] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getChildToken()) { setLoading(false); return }
    getChildMe().then(setChild).catch(() => childLogout()).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="child-login">
        <Avatar speaking={false} mood="happy" />
        <p className="muted">Finding your buddy…</p>
      </div>
    )
  }
  if (!child) return <ChildLogin onLoggedIn={setChild} />
  return <Experience child={child} setChild={setChild} onLogout={() => { childLogout(); setChild(null) }} />
}

function Experience({ child, setChild, onLogout }) {
  const [status, setStatus] = useState('idle') // idle | listening | thinking | speaking
  // A page refresh used to always start over at a blank greeting even
  // mid-conversation (real bug, see loadCachedSession's comment above) —
  // computed once, before the very first render, so the greeting effect
  // and the session-start effect below can both check it without a flash
  // of the wrong content first.
  const restoredRef = useRef(loadCachedSession(child.id))
  // The visible transcript IS the context window (see storage.session_history
  // on the backend) — every turn shown here is exactly what gets sent back to
  // the brain as conversation memory, nothing hidden or summarised away.
  //
  // Placeholder text until the streak effect below replaces it — the streak
  // itself is known almost instantly (localStorage, not a network call), so
  // this is up on screen for at most a frame or two, not a visible flash of
  // the wrong greeting. Skipped entirely when resuming a cached session.
  const [turns, setTurns] = useState(() => (
    restoredRef.current?.turns?.length
      ? restoredRef.current.turns
      : [{ id: 'greeting', role: 'pip', text: `Hi ${child.name}! Tap the mic or type below to tell me what you'd like to read or watch.` }]
  ))
  const [view, setView] = useState('chat')       // 'chat' | 'library' — Library is a real screen, not a modal
  const [overlay, setOverlay] = useState(null)   // 'avatar' | null
  const [favs, setFavs] = useState([])
  const [details, setDetails] = useState(null)   // a rec item
  const [video, setVideo] = useState(null)       // a rec item
  const [typed, setTyped] = useState('')
  // CH04 — ties messages together for real conversation memory (CH07).
  // Restored from cache (see restoredRef above) so a refresh keeps talking
  // to the SAME backend session instead of silently starting a new one.
  const [sessionId, setSessionId] = useState(() => restoredRef.current?.sessionId ?? null)
  const recognitionRef = useRef(null)
  const transcriptEndRef = useRef(null)
  const lastBubbleRef = useRef(null)
  // Real backend TTS (see speak(), below) — the currently-playing <audio>
  // element, so a new reply can stop whatever Pip was already saying,
  // same way window.speechSynthesis.cancel() does for the browser fallback.
  const audioRef = useRef(null)

  const hasChatted = turns.some((t) => t.role === 'child')

  // Daily-streak badge — frontend-only (see streak.js), recorded once when
  // the chat screen mounts for this child, not on every message. Pip's own
  // opening line reflects it too (CH04: "a returning child's greeting
  // should draw on prior [visits], so it doesn't feel like starting over
  // at a blank screen every visit") — the streak lives in a badge already,
  // but a companion who never actually *says* "welcome back" is still
  // just a UI element wearing a character's name.
  const [streak, setStreak] = useState(0)
  useEffect(() => {
    const s = recordVisit(child.id)
    setStreak(s)
    // A restored session already has its own real greeting turn (and
    // whatever came after it) — recomputing a fresh one here would
    // silently throw away everything the refresh was supposed to keep.
    if (restoredRef.current) return
    const greeting = s > 1
      ? `Hi ${child.name}! You're back ${s} days in a row — I love that! What should we find today?`
      : `Hi ${child.name}! Tap the mic or type below to tell me what you'd like to read or watch.`
    setTurns([{ id: 'greeting', role: 'pip', text: greeting }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child.id])

  // Loaded once on mount (not just lazily when the Favourites overlay
  // opens) so a returning child sees "pick up where you left off" on the
  // screen they actually land on, instead of it only existing one tap
  // behind a header button. See the "Welcome back" strip below.
  useEffect(() => {
    myFavourites().then(setFavs).catch(() => {})
  }, [child.id])

  // A topic Pip once had to say "Oops" to THIS child about, that real
  // content now actually covers — same "pick up where you left off"
  // continuity as favourites above, for a gap that's since been filled.
  // Null (not fetched yet, or genuinely nothing new) just renders nothing.
  const [resolved, setResolved] = useState(null)
  useEffect(() => {
    resolvedTopic().then((r) => {
      if (r) {
        setResolved(r)
        // Stamped the moment it's actually shown, not just fetched — a
        // separate mutating call the GET above deliberately doesn't do
        // itself (see that endpoint's own docstring for why).
        ackResolvedTopic(r.topic).catch(() => {})
      }
    }).catch(() => {})
  }, [child.id])

  // Real topic chips (see FALLBACK_TOPIC_PROMPTS above for what shows
  // while this is still loading or if it comes back empty).
  const [topics, setTopics] = useState(null)
  useEffect(() => {
    getTopics().then(setTopics).catch(() => setTopics([]))
  }, [child.id])

  // Voice on/off — every Pip reply used to auto-narrate with no way to
  // silence it short of the device's own volume. Persisted per child,
  // same localStorage pattern as the streak counter.
  const canSpeak = 'speechSynthesis' in window
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(`pip_muted_${child.id}`) === '1' } catch { return false }
  })
  function toggleMuted() {
    setMuted((m) => {
      const next = !m
      try { localStorage.setItem(`pip_muted_${child.id}`, next ? '1' : '0') } catch { /* ignore */ }
      if (next) {
        window.speechSynthesis?.cancel()
        audioRef.current?.pause()
      }
      return next
    })
  }

  // CH04 — a chat session starts once, when the child reaches this screen
  // (already-logged-in trigger, per the URS). Its id rides along on every
  // message so the backend can hand the brain real prior-turn context.
  //
  // Real race found live (2026-09-09): the starter chips (below) are
  // clickable the instant the screen renders, but this session-start call
  // is async — a fast tap could fire `ask()` before `setSessionId` ever
  // ran, sending `session_id: null`. The backend still logs it fine, but
  // every null-session message collapses into one shared "unknown" bucket
  // on the parent's Activity view (see ParentDashboard.jsx's
  // groupBySession) instead of each showing up as its own real session —
  // reads as "it just didn't save" even though it did. A ref (not state)
  // holds the in-flight promise so `ask()` below can always await the
  // *real* id regardless of when it's called, closing the race for both
  // typed messages and chip taps rather than only fixing whichever one
  // happened to be reported.
  const sessionReadyRef = useRef(null)
  useEffect(() => {
    // Resuming a cached session (see restoredRef above) — `sessionId`
    // state already has the real id from its own lazy initializer, so
    // there's nothing to start; just satisfy `ask()`'s `await
    // sessionReadyRef.current` fallback with the same id instead of
    // opening a second, redundant backend session on every refresh.
    if (restoredRef.current?.sessionId) {
      sessionReadyRef.current = Promise.resolve(restoredRef.current.sessionId)
      return
    }
    let cancelled = false
    sessionReadyRef.current = startChatSession()
      .then((s) => { if (!cancelled) setSessionId(s.id); return s.id })
      .catch(() => null)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // 'auto' (instant), not 'smooth' — smooth scroll is a requestAnimationFrame
    // animation, which browsers throttle/skip in a backgrounded tab, so a
    // child switching apps mid-reply could come back to the reply scrolled
    // out of view. Instant scroll is a synchronous position set, not subject
    // to that — reliability here matters more than the animation.
    //
    // Which target we scroll to differs on purpose: a reply that comes with
    // recommendation cards is tall (bubble + cards + "something else"), and
    // scrolling all the way to the transcript's own end hid Pip's own
    // sentence above the fold — a child would see only cards, which reads
    // exactly like a bare search-results list. For that case, scroll the
    // reply bubble itself into view (top-aligned) so what Pip said is
    // always visible before the cards. Every other case (plain text reply,
    // the child's own just-sent message, the pending "thinking" bubble)
    // keeps the original behaviour of scrolling to the true end.
    const last = turns[turns.length - 1]
    if (last?.role === 'pip' && !last.pending && last.recs?.length > 0) {
      lastBubbleRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
    } else {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    }
  }, [turns])

  // Keeps the refresh-survives-a-reload fix (see loadCachedSession's
  // comment near the top of this file) up to date after every message —
  // cheap (sessionStorage, small transcript) and just a snapshot, so a
  // failed write here is never worse than the pre-fix behaviour.
  useEffect(() => {
    saveCachedSession(child.id, { sessionId, turns })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, sessionId])

  // CH05 — ends the session on logout ("before handing back a shared
  // device") rather than leaving it open forever.
  function logoutAndEndSession() {
    if (sessionId) endChatSession(sessionId).catch(() => {})
    clearCachedSession(child.id)
    onLogout()
  }

  const supported = Boolean(SpeechRecognition) && 'speechSynthesis' in window
  const color = child.avatar in AVATAR_COLORS ? child.avatar : 'purple'

  // Browser fallback (Web Speech API) — only used when real TTS isn't
  // available (no OpenAI key configured on the backend, or a network
  // hiccup). Voice quality here is entirely device/OS-dependent; kept as a
  // safety net so Pip never goes fully silent, not as the primary voice.
  function speakBrowser(text) {
    if (!('speechSynthesis' in window)) { setStatus('idle'); return }
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.02
    u.pitch = 1.3
    const voices = window.speechSynthesis.getVoices()
    const english = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'))
    const preferred =
      english.find((v) => /natural/i.test(v.name) && /\bana\b/i.test(v.name)) ||
      english.find((v) => /natural/i.test(v.name) && /aria|jenny|emma|libby|female/i.test(v.name)) ||
      english.find((v) => /samantha|karen|moira|tessa|fiona/i.test(v.name)) ||
      english.find((v) => /google.*female/i.test(v.name)) ||
      english.find((v) => /female|zira|hazel|susan|kathy/i.test(v.name)) ||
      english[0]
    if (preferred) u.voice = preferred
    u.onstart = () => setStatus('speaking')
    u.onend = () => setStatus('idle')
    u.onerror = () => setStatus('idle')
    window.speechSynthesis.speak(u)
  }

  // CH11 — Pip's real voice: a warm, kid-friendly OpenAI TTS voice
  // generated server-side (see api.js's speakPip / backend's
  // /api/chat/speech), consistent across every device instead of whatever
  // the browser happens to ship. Falls back to speakBrowser() above if the
  // real voice isn't available for any reason, so a missing/failed key
  // never leaves Pip silent.
  //
  // Async and *awaited by its callers before they reveal Pip's text* (see
  // ask(), below) — real TTS needs a network round-trip to generate the
  // audio, unlike the old instant browser speechSynthesis call, so if the
  // text bubble appeared first the voice would visibly lag behind it by a
  // second or two. Awaiting this until the audio has actually started (or
  // we've fallen back) keeps the reply and the voice appearing together.
  async function speak(text) {
    if (muted) { setStatus('idle'); return }
    window.speechSynthesis?.cancel()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    try {
      const url = await speakPip(text)
      if (muted) return // toggled off while the request was in flight
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onplay = () => setStatus('speaking')
      audio.onended = () => { setStatus('idle'); URL.revokeObjectURL(url) }
      audio.onerror = () => { setStatus('idle'); URL.revokeObjectURL(url) }
      await audio.play()
    } catch {
      speakBrowser(text)
    }
  }

  // Pip actually reacts to a save instead of it being silent UI-state on a
  // button — Khan Academy Kids' "companion acknowledges what you did"
  // principle, adapted narrowly: no new badge/chrome, just Pip's existing
  // voice reused for one more real moment. Also fixes a real (if small)
  // continuity bug: `favs` was only ever fetched on mount, so a freshly
  // saved item didn't show up in the Library/Welcome-back strip until the
  // next full reload.
  // Async, and re-throws on failure (the free-favourites-cap 403 included)
  // so RecommendationCard's own save() can show the real error instead of
  // both of us assuming success — see that component for why this used to
  // be a false-positive "Saved!" regardless of what the API actually did.
  async function handleSave(item) {
    await saveFavourite(item.id)
    setFavs((prev) => (prev.some((f) => f.id === item.id) ? prev : [...prev, item]))
    speak(`Saved it! I'll remember you like ${curateTitle(item.title)}.`)
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
      // Prefer the already-resolved state (avoids an unnecessary await on
      // the common case), but fall back to the in-flight promise so a fast
      // tap never races ahead of session creation — see the effect above.
      const activeSessionId = sessionId ?? (await sessionReadyRef.current)
      const res = await askPip(message, activeSessionId)
      // Wait for Pip's voice to actually start (or fail over to the
      // browser fallback) BEFORE revealing the reply text — real TTS needs
      // a network round-trip, so speaking first and revealing after keeps
      // the two in sync instead of the text jumping in ahead of the voice.
      // "Thinking…" stays on screen a little longer to cover this, which
      // reads fine — Pip is still "getting ready to answer".
      await speak(res.reply)
      setTurns((t) => t.map((turn) => (
        turn.id === pipId ? { ...turn, text: res.reply, recs: res.recommendations || [], pending: false } : turn
      )))
    } catch {
      // Used to fall back to a local keyword-matched "brain" (placeholderBot.js
      // — a leftover from before the real backend existed) that named
      // specific book/video titles by itself. That's a real safety-principle
      // violation, not just stale copy: this product's whole guarantee is
      // that Pip can only ever recommend something a moderator already
      // vetted, never invent one — and the failure path is exactly where a
      // silent violation like that is easiest to miss (found during an
      // audit, not by anyone hitting it live). An honest "something went
      // wrong, try again" — with zero recommendations, same as any other
      // real error — is the only fallback that keeps that guarantee even
      // when the backend call itself fails.
      const fallback = "Hmm, I'm having a little trouble right now. Can you try asking again in a moment?"
      await speak(fallback)
      setTurns((t) => t.map((turn) => (
        turn.id === pipId ? { ...turn, text: fallback, recs: [], pending: false } : turn
      )))
    }
  }

  function startListening() {
    if (!SpeechRecognition || status === 'thinking' || status === 'speaking') return
    if (status === 'listening') { recognitionRef.current?.stop(); return }
    window.speechSynthesis?.cancel()
    audioRef.current?.pause()

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
    return () => {
      window.speechSynthesis?.cancel()
      audioRef.current?.pause()
      recognitionRef.current?.abort?.()
    }
  }, [])

  const [favsError, setFavsError] = useState(false)
  async function openLibrary() {
    setView('library')
    setFavsError(false)
    try { setFavs(await myFavourites()) } catch { setFavsError(true) }
  }

  // CH16's missing half — without this, the free-tier 5-item cap (PA34) is
  // permanent: once a Free child fills their library there's no way to make
  // room for something new. Optimistic (unlike handleSave, a failed remove
  // has no safety-relevant consequence to hide), but still reverts on a
  // genuine failure rather than silently pretending it worked.
  async function handleRemoveFavourite(item) {
    setFavs((prev) => prev.filter((f) => f.id !== item.id))
    try {
      await removeFavourite(item.id)
    } catch {
      setFavs((prev) => (prev.some((f) => f.id === item.id) ? prev : [...prev, item]))
    }
  }

  // Point 6 of the product brief: the "keep exploring by category" pattern
  // from YouTube Kids/PBS Kids ("up next," character/topic rails), adapted
  // narrowly — not copied as a browsable grid (that's exactly the
  // search-engine pattern this product exists to not be). The moment a
  // child is engaged enough to open Details or press Watch is the natural
  // point to offer "more like this," using the item's own real genre tag
  // (never a fabricated "recommended for you" claim) instead of a second
  // affordance crammed onto every card.
  function moreLikeThis(item) {
    setDetails(null)
    setVideo(null)
    const genre = item.genres?.[0]
    ask(genre ? `Do you have more ${item.type}s about ${genre}?` : `Do you have anything else like ${curateTitle(item.title)}?`)
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
        {/* Same brand mark as the landing page's nav (.landing-brand) —
            clicking it reloads this screen, the same "tap the logo to get
            back to a clean state" convention as any other app, not a
            navigation link (a child mid-chat shouldn't get bounced all the
            way out to the marketing page from one stray tap). Positioned
            independently of "Hi, Alex!" below (see .child-brand's own
            comment) — it sits at the bar's own actual corner; "Hi, Alex!"
            keeps its separate alignment with the chat bubble underneath,
            unaffected by whatever the logo does. */}
        <button type="button" className="child-brand" onClick={() => window.location.reload()} aria-label="Refresh">
          <Avatar speaking={false} mood="happy" />
          <span>Pip</span>
        </button>
        <h1 className="who">
          Hi, {child.name}!
          {streak > 1 && (
            <span className="streak-badge"><FlameIcon width={14} height={14} /> {streak}-day streak</span>
          )}
        </h1>
        <div className="bar-btns">
          {canSpeak && (
            <button className="pill" onClick={toggleMuted} aria-label={muted ? "Turn Pip's voice on" : "Turn Pip's voice off"}>
              <SpeakerIcon muted={muted} width={16} height={16} /> {muted ? 'Sound off' : 'Sound on'}
            </button>
          )}
          <button
            className={`pill ${view === 'library' ? 'pill--active' : ''}`}
            onClick={() => (view === 'library' ? setView('chat') : openLibrary())}
          >
            <HeartIcon width={16} height={16} filled={view === 'library'} /> Library
          </button>
          <button className="pill" onClick={() => setOverlay('avatar')}><PaletteIcon width={16} height={16} /> Avatar</button>
          <button className="pill" onClick={logoutAndEndSession}><LogoutIcon width={16} height={16} /> Log out</button>
        </div>
      </div>

      {view === 'library' ? (
        <LibraryView
          favs={favs}
          favsError={favsError}
          onRetry={openLibrary}
          onRemove={handleRemoveFavourite}
          onTalkAbout={(title) => { setView('chat'); ask(`Tell me more about ${title}`) }}
        />
      ) : (
      <>
      <div className="chat-shell">
        <div className="chat-presence">
          <div className={`chat-presence-glow ${speaking ? 'chat-presence-glow--active' : ''}`} />
          <Avatar speaking={speaking} mood={speaking ? 'idle' : 'happy'} color={color} />
          <p className={`chat-status ${listening ? 'chat-status-listening' : ''}`} aria-live="polite">{statusLine || ' '}</p>
        </div>

        {/* .chat-transcript itself is now the full-width scrolling surface
            (no max-width of its own) — its native scrollbar sits at the
            screen's real right edge instead of floating mid-page at the
            edge of a centered column, which is what it did when the
            content cap lived on this same element ("scroll barnya di
            posisi itu... di bagian kanan pojok aja" — flagged directly,
            screenshot showed it stranded ~300px in from the actual browser
            edge on a wide monitor). .chat-transcript-inner below carries
            the 1100px reading-column cap that used to live here, same
            "full-width surface, capped inner column" split App.css already
            uses for .child-bar/.chat-input-bar. */}
        <div className="chat-transcript" role="log" aria-live="polite">
        <div className="chat-transcript-inner">
          {turns.map((turn, i) => (
            <div key={turn.id} className={`bubble-row bubble-row-${turn.role}`}>
              <div ref={i === turns.length - 1 ? lastBubbleRef : null} className={`bubble bubble-${turn.role}`}>
                {turn.pending ? (
                  <span className="bubble-dots" aria-label="Pip is thinking">
                    <span></span><span></span><span></span>
                  </span>
                ) : turn.text}
              </div>

              {turn.recs?.length > 0 && (
                <div className="bubble-recs">
                  {turn.recs.map((item, i) => (
                    <RecommendationCard
                      key={item.id}
                      item={item}
                      topPick={i === 0 && turn.recs.length > 1}
                      onDetails={setDetails}
                      onWatch={setVideo}
                      onSave={handleSave}
                      onFeedback={(it, liked) => sendFeedback(it.id, liked).catch(() => {})}
                    />
                  ))}
                  {/* A sparkle, not a reload icon — "show me another" is
                      Pip offering a new idea, not the page retrying a
                      failed request. */}
                  <button className="pill" onClick={() => ask(turn.sourceMessage)}>
                    <SparkleIcon width={15} height={15} /> Something else, please!
                  </button>
                </div>
              )}
            </div>
          ))}

          {!hasChatted && (streak > 1 || favs.length > 0 || resolved) && (
            // A returning child's whole "product hub" is this screen — there's
            // no separate browse-first homepage by design (that's the search-
            // engine pattern this product exists to not be). So continuity has
            // to live here: the streak they already earned, real saved
            // items they can jump straight back into talking about, and now
            // a gap Pip once had to say "no" to them about that's since been
            // filled — instead of greeting a three-day regular exactly like
            // a first-time visitor.
            <div className="welcome-back">
              <p className="welcome-back-lead">
                {streak > 1 ? `Welcome back — ${streak} days in a row!` : 'Welcome back!'}
              </p>
              {resolved && (
                <div className="welcome-back-favs">
                  <span className="welcome-back-favs-label">I found something new!</span>
                  <div className="welcome-back-fav-row">
                    <button
                      className="welcome-back-fav-chip"
                      onClick={() => ask(`Tell me more about ${curateTitle(resolved.item.title)}`)}
                    >
                      {resolved.item.type === 'book' ? <BookIcon width={14} height={14} /> : <VideoIcon width={14} height={14} />}
                      <span>{curateTitle(resolved.item.title)}</span>
                    </button>
                  </div>
                </div>
              )}
              {favs.length > 0 && (
                <div className="welcome-back-favs">
                  <span className="welcome-back-favs-label">Pick up where you left off</span>
                  <div className="welcome-back-fav-row">
                    {favs.slice(0, 3).map((f) => (
                      <button
                        key={f.id}
                        className="welcome-back-fav-chip"
                        onClick={() => ask(`Tell me more about ${curateTitle(f.title)}`)}
                      >
                        {f.type === 'book' ? <BookIcon width={14} height={14} /> : <VideoIcon width={14} height={14} />}
                        <span>{curateTitle(f.title)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!hasChatted && (
            <div className="starter-row">
              {[
                ...EVERGREEN_PROMPTS,
                ...(topics && topics.length > 0
                  ? topics.slice(0, 4).map((t) => ({
                      icon: iconForGenre(t.genre),
                      label: capitalize(t.genre),
                      message: `Do you have anything about ${t.genre}?`,
                    }))
                  : FALLBACK_TOPIC_PROMPTS),
              ].map(({ icon: Icon, label, message }) => (
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
            <MicIcon width={30} height={30} />
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
          <SendIcon width={30} height={30} />
        </button>
      </form>
      </>
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

      {/* CH14 — content details. Still never shows the catalogue's raw
          scraped `description` (real box-set/marketing listing text —
          verified live to include asterisk-bullet lists and mid-word
          truncation, disposable ad copy Pip would never actually say).
          `synopsis` is the real thing to read — a genuine 2-4 sentence
          summary generated once when the item went live (see
          app/ai_assist.py's generate_synopsis) — this used to be the ONLY
          thing shown here, which read as "too plain, nothing to actually
          read" (flagged directly). `explanation` (why THIS pick fits what
          the child asked for) now sits underneath as its own short line,
          not standing in for a synopsis it was never meant to be. Falls
          back to `explanation` alone for an older item that predates this
          feature or whose generation failed, so Details is never empty. */}
      {details && (
        <Overlay title={curateTitle(details.title)} icon={details.type === 'book' ? BookIcon : VideoIcon} onClose={() => setDetails(null)}>
          {details.thumbnail && <img className="rec-cover" src={details.thumbnail} alt="" />}
          <p className="rec-synopsis">{details.synopsis || details.explanation}</p>
          {details.synopsis && (
            <p className="rec-why"><SparkleIcon width={14} height={14} /> {details.explanation}</p>
          )}
          <button className="pill overlay-more-like" onClick={() => moreLikeThis(details)}>
            <CompassIcon width={15} height={15} /> More like this
          </button>
        </Overlay>
      )}

      {/* CH12 — watch embedded video */}
      {video && (
        <Overlay title={curateTitle(video.title)} icon={VideoIcon} onClose={() => setVideo(null)}>
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
          <button className="pill overlay-more-like" onClick={() => moreLikeThis(video)}>
            <CompassIcon width={15} height={15} /> More like this
          </button>
        </Overlay>
      )}
    </div>
  )
}

// CH16 — a real screen, not a modal a child has to remember exists. Every
// saved item leads back into an actual conversation with Pip about it
// ("Talk about this"), not a dead-end shelf — the library and the chat
// are one product, not two features bolted together. Remove closes the
// free-tier cap dead-end (PA34's 5-item limit was otherwise permanent).
function LibraryView({ favs, favsError, onRetry, onRemove, onTalkAbout }) {
  return (
    <div className="library-view">
      <div className="library-head">
        <h2><HeartIcon width={22} height={22} filled /> My Library</h2>
        <p className="muted">{favs.length === 0 ? 'Nothing saved yet' : `${favs.length} saved ${favs.length === 1 ? 'item' : 'items'}`}</p>
      </div>

      {favs.length === 0 && favsError && (
        <div className="library-empty">
          <p className="muted">Pip couldn't load your library right now.</p>
          <button className="pill" onClick={onRetry}>Try again</button>
        </div>
      )}

      {favs.length === 0 && !favsError && (
        <div className="library-empty">
          <SparkleIcon width={30} height={30} />
          <p>Nothing here yet — when Pip finds something you love, tap <b>Save</b> and it'll show up in your library.</p>
        </div>
      )}

      {favs.length > 0 && (
        <div className="library-grid">
          {favs.map((f) => (
            <div className="library-card" key={f.id}>
              {f.thumbnail ? (
                <img className="library-cover" src={f.thumbnail} alt="" loading="lazy" />
              ) : (
                <div className="library-cover library-cover-empty">
                  {f.type === 'book' ? <BookIcon width={26} height={26} /> : <VideoIcon width={26} height={26} />}
                </div>
              )}
              <div className="library-card-body">
                <p className="library-card-title">
                  {f.type === 'book' ? <BookIcon width={13} height={13} /> : <VideoIcon width={13} height={13} />}
                  {curateTitle(f.title)}
                </p>
                {f.genres?.length > 0 && (
                  <div className="rec-tags">
                    {f.genres.slice(0, 2).map((g) => <span className="rec-tag" key={g}>{g}</span>)}
                  </div>
                )}
                <div className="library-card-actions">
                  <button className="library-card-action" onClick={() => onTalkAbout(curateTitle(f.title))}>
                    <ChatIcon width={14} height={14} /> Talk about this
                  </button>
                  <button
                    className="library-card-action library-card-action--remove"
                    onClick={() => onRemove(f)}
                    aria-label={`Remove ${curateTitle(f.title)} from your library`}
                  >
                    <TrashIcon width={14} height={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Overlay({ title, icon: Icon, children, onClose }) {
  const titleId = useId()
  const closeRef = useRef(null)
  const triggerRef = useRef(document.activeElement)

  useEffect(() => {
    // Move focus into the dialog on open, restore it to whatever opened
    // the dialog on close, and let Escape dismiss it — none of that
    // existed before (a keyboard/screen-reader user had no signal a
    // modal had even opened, and no way out but a mouse click).
    closeRef.current?.focus()
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      triggerRef.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} className="pill close" onClick={onClose} aria-label="Close"><CloseIcon width={16} height={16} /></button>
        <h2 id={titleId}>{Icon && <Icon width={20} height={20} />} {title}</h2>
        {children}
      </div>
    </div>
  )
}
