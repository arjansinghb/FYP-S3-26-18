// One recommendation card — CH08/CH09 (Receive Book/Video Recommendation) +
// CH10 (explanation) rendered together, with inline CH11 (Listen, TTS), CH15
// (Save), and CH17 (Feedback) controls. Rendered *inside* the chat flow (see
// agent-context/CLAUDE.md §2.1/§9) — never a separate results page.
import { useState } from 'react'
import { giveFeedback, saveFavourite } from '../api/client'
import type { RecommendationOut } from '../types'

interface Props {
  rec: RecommendationOut
  childId: string
  token: string
}

export default function RecommendationCard({ rec, childId, token }: Props) {
  const [saved, setSaved] = useState(false)
  const [feedback, setFeedback] = useState<'liked' | 'disliked' | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (saved || busy) return
    setBusy(true)
    try {
      await saveFavourite(childId, token, rec.item_id)
      setSaved(true)
    } catch {
      // Free-tier cap (5) or other error — surfaced gently, not a hard crash.
      setSaved(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleFeedback(liked: boolean) {
    setFeedback(liked ? 'liked' : 'disliked')
    try {
      await giveFeedback(rec.item_id, token, liked)
    } catch {
      // best-effort — feedback isn't load-bearing for the rest of the flow
    }
  }

  function handleListen() {
    if (!('speechSynthesis' in window)) return
    const utterance = new SpeechSynthesisUtterance(`${rec.title}. ${rec.reason}`)
    window.speechSynthesis.speak(utterance)
  }

  const isPlayableVideo = rec.type === 'video' && !!rec.embed_url

  return (
    <div className={`rec-card ${isPlayableVideo ? 'rec-card--video' : ''}`}>
      {isPlayableVideo ? (
        // CH12 — Watch Embedded Video. Stays inside the app (an iframe embed,
        // not a link out) — that's what makes this a *child*-facing use case
        // rather than PA19's parent-only external link.
        <div className="rec-card-video">
          <iframe
            src={rec.embed_url!}
            title={rec.title}
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <div className={`rec-card-cover rec-card-cover--${rec.type}`}>
          <span>{rec.type === 'book' ? '📖' : '🎬'}</span>
          <span className="rec-card-cover-tag">{rec.type === 'book' ? 'Book' : 'Video'}</span>
        </div>
      )}
      <div className="rec-card-body">
        <div className="rec-card-title">{rec.title}</div>
        <div className="rec-card-reason">{rec.reason}</div>
        <div className="rec-card-actions">
          <button className="rec-action rec-action--primary" onClick={handleSave} disabled={busy || saved}>
            <span className="rec-action-icon">{saved ? '✅' : '⭐'}</span>
            <span>{saved ? 'Saved' : 'Save'}</span>
          </button>
          {'speechSynthesis' in window && (
            <button className="rec-action rec-action--secondary" onClick={handleListen}>
              <span className="rec-action-icon">🔊</span>
              <span>Listen</span>
            </button>
          )}
          <div className="rec-icon-group">
            <button
              className={`rec-icon-btn ${feedback === 'liked' ? 'rec-icon-btn--liked' : ''}`}
              onClick={() => handleFeedback(true)}
              aria-label="I liked this"
            >
              👍
            </button>
            <button
              className={`rec-icon-btn ${feedback === 'disliked' ? 'rec-icon-btn--disliked' : ''}`}
              onClick={() => handleFeedback(false)}
              aria-label="Not for me"
            >
              👎
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
