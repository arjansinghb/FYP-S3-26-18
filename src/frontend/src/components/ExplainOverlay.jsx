import { useEffect, useRef, useState } from 'react'
import Avatar from './Avatar'
import Overlay from './Overlay'
import { explainToPip } from '../api'
import { curateTitle } from '../curate'
import { BookIcon, MicIcon, SendIcon, VideoIcon } from '../icons'

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
const MAX_CHARS = 800

// CH21 — "Tell Pip about this". The child explains a saved book or video in
// their own words, by voice or by typing. Voice reuses the same browser
// speech-to-text as the chat's mic (CH06): a six-year-old won't type a
// paragraph. What they say lands in the box first so they can see it (and
// fix it) before sending. Pip answers warmly and never grades; whether it
// shows understanding is the parent's call, later, out of sight.
export default function ExplainOverlay({ item, color, onClose, onDone, speak }) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [sending, setSending] = useState(false)
  const [reply, setReply] = useState(null)
  const [error, setError] = useState('')
  const recognitionRef = useRef(null)
  const baseRef = useRef('')
  const usedVoiceRef = useRef(false)

  useEffect(() => () => recognitionRef.current?.abort?.(), [])

  function toggleMic() {
    if (!SpeechRecognition) return
    if (listening) { recognitionRef.current?.stop(); return }
    window.speechSynthesis?.cancel()
    const rec = new SpeechRecognition()
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = true
    baseRef.current = text ? `${text.trim()} ` : ''
    rec.onstart = () => { setListening(true); setError('') }
    rec.onresult = (e) => {
      let spoken = ''
      for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0].transcript
      usedVoiceRef.current = true
      setText((baseRef.current + spoken).slice(0, MAX_CHARS))
    }
    rec.onerror = (e) => {
      setListening(false)
      if (e.error !== 'no-speech' && e.error !== 'aborted') setError("I couldn't hear that. You can tap the mic again, or type instead.")
    }
    rec.onend = () => setListening(false)
    recognitionRef.current = rec
    rec.start()
  }

  async function send(e) {
    e.preventDefault()
    const message = text.trim()
    if (!message || sending) return
    recognitionRef.current?.stop?.()
    setSending(true)
    setError('')
    try {
      const res = await explainToPip(item.id, message, usedVoiceRef.current ? 'voice' : 'text')
      setReply(res.pip_reply)
      if (res.saved) onDone(item)
      speak?.(res.pip_reply)
    } catch (err) {
      setError(err?.message || "Pip couldn't hear that just now. Try again in a moment.")
    } finally {
      setSending(false)
    }
  }

  const TypeIcon = item.type === 'book' ? BookIcon : VideoIcon

  return (
    <Overlay title={`Tell Pip about ${curateTitle(item.title)}`} icon={TypeIcon} onClose={onClose}>
      {reply ? (
        <div className="explain-reply">
          <Avatar speaking={false} mood="happy" color={color} />
          <p className="explain-reply-text">{reply}</p>
          <button type="button" className="pill pill--active" onClick={onClose}>All done</button>
        </div>
      ) : (
        <form className="explain-form" onSubmit={send}>
          <p className="explain-prompt">What was it about? Tell Pip in your own words. Say what you liked, or what you noticed.</p>
          <textarea
            className="explain-box"
            value={text}
            onChange={(e) => { setText(e.target.value); if (!e.target.value) usedVoiceRef.current = false }}
            maxLength={MAX_CHARS}
            rows={5}
            placeholder={listening ? "I'm listening…" : 'Tap the mic and talk, or type here.'}
            aria-label="What do you want to tell Pip?"
          />
          <div className="explain-actions">
            {SpeechRecognition ? (
              <button type="button" className={`pill ${listening ? 'pill--active' : ''}`} onClick={toggleMic} aria-pressed={listening}>
                <MicIcon width={16} height={16} /> {listening ? 'Stop' : 'Talk to Pip'}
              </button>
            ) : (
              <span className="muted explain-note">Typing works great too!</span>
            )}
            <button type="submit" className="pill pill--active" disabled={!text.trim() || sending}>
              <SendIcon width={16} height={16} /> {sending ? 'Sending…' : 'Tell Pip'}
            </button>
          </div>
          {error && <p className="rec-error">{error}</p>}
        </form>
      )}
    </Overlay>
  )
}
