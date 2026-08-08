import { useEffect, useRef, useState } from 'react'
import Avatar from './components/Avatar'
import { getReply } from './placeholderBot'
import './App.css'

const GREETING = "Hi! I'm Pip. Tap the big button and tell me what you'd like to read or watch!"

// Browser's built-in voice recognition (speech -> text). Best in Chrome/Edge.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

export default function App() {
  // status drives everything: idle | listening | thinking | speaking
  const [status, setStatus] = useState('idle')
  const [caption, setCaption] = useState(GREETING)
  const recognitionRef = useRef(null)

  const supported = Boolean(SpeechRecognition) && 'speechSynthesis' in window

  // Pip speaks a line out loud; the mouth animates while status === 'speaking'.
  function speak(text) {
    setCaption(text)
    if (!('speechSynthesis' in window)) {
      setStatus('idle')
      return
    }
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.95
    u.pitch = 1.25 // slightly higher = friendlier for kids
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

  // Child finished speaking -> placeholder brain picks a reply -> Pip speaks it.
  function handleChildSpeech() {
    setStatus('thinking')
    setCaption('Hmm, let me think…')
    setTimeout(() => speak(getReply(recognitionRef.current?._lastTranscript || '')), 450)
  }

  function startListening() {
    if (!SpeechRecognition || status === 'thinking' || status === 'speaking') return
    if (status === 'listening') {
      recognitionRef.current?.stop()
      return
    }
    window.speechSynthesis?.cancel()

    const rec = new SpeechRecognition()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1
    recognitionRef.current = rec

    rec.onstart = () => {
      setStatus('listening')
      setCaption("Listening… I'm all ears!")
    }
    rec.onresult = (e) => {
      rec._lastTranscript = e.results[0][0].transcript
      handleChildSpeech()
    }
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
    rec.onend = () => {
      setStatus((s) => (s === 'listening' ? 'idle' : s))
    }
    rec.start()
  }

  // Preload voices (they can load asynchronously) and clean up on exit.
  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices()
    }
    return () => {
      window.speechSynthesis?.cancel()
      recognitionRef.current?.abort?.()
    }
  }, [])

  const speaking = status === 'speaking'
  const listening = status === 'listening'

  if (!supported) {
    return (
      <div className="app">
        <div className="stage">
          <Avatar speaking={false} mood="happy" />
          <p className="caption">
            Hi! To talk to me, please open this page in <b>Google Chrome</b> or{' '}
            <b>Microsoft Edge</b>. 😊
          </p>
        </div>
      </div>
    )
  }

  const buttonLabel = listening
    ? 'Listening… tap to stop'
    : status === 'thinking'
    ? 'Thinking…'
    : status === 'speaking'
    ? 'Pip is talking…'
    : 'Tap to talk'

  return (
    <div className="app">
      <div className="stage">
        <Avatar speaking={speaking} mood={speaking ? 'idle' : 'happy'} />

        <p className={`caption ${listening ? 'caption-listening' : ''}`}>{caption}</p>

        <button
          className={`talk ${listening ? 'talk-listening' : ''}`}
          onClick={startListening}
          disabled={status === 'thinking' || status === 'speaking'}
          aria-label={listening ? 'Stop listening' : 'Tap to talk'}
        >
          <span className="talk-icon" aria-hidden="true">🎤</span>
          <span>{buttonLabel}</span>
        </button>
      </div>

      <footer className="app-footer">
        FYP-26-S3-18 · voice avatar prototype · Pip's answers are placeholders for
        now — the real AI brain gets connected later. Works best in Chrome/Edge.
      </footer>
    </div>
  )
}
