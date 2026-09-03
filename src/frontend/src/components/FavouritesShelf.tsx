// CH16 — View Saved Favourites (child-side). dev-session 2026-08-21: this
// use case had a backend endpoint (listFavourites) but no frontend screen
// at all — a child could star something (CH15) but never actually look at
// their collection again. Built as an engagement feature too: a visual
// "shelf" of everything they've saved, reachable from ChatScreen's header,
// not just a functional gap-filler.
import { useEffect, useState } from 'react'
import { listFavourites, removeFavourite } from '../api/client'
import { RemoveIcon, SpeakerIcon, StarIcon } from '../icons'
import { useSpeech } from '../state/useSpeech'
import type { Favourite } from '../types'

interface Props {
  token: string
  childId: string
  onBack: () => void
}

export default function FavouritesShelf({ token, childId, onBack }: Props) {
  const [favourites, setFavourites] = useState<Favourite[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Independent from ChatScreen's own useSpeech() instance — fine, since the
  // big companion avatar (the thing that visualises "speaking") only lives
  // on the chat screen anyway, not here.
  const { speak: onSpeak, supported: canSpeak } = useSpeech()

  useEffect(() => {
    listFavourites(childId, token).then(setFavourites)
  }, [childId, token])

  async function handleRemove(favouriteId: string) {
    setBusyId(favouriteId)
    try {
      await removeFavourite(childId, token, favouriteId)
      setFavourites((prev) => prev?.filter((f) => f.id !== favouriteId) ?? prev)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="chat-screen">
      <header className="chat-header">
        <button className="link-button" onClick={onBack}>
          ← Back
        </button>
        <div className="chat-header-name">
          <StarIcon filled /> My Favourites
        </div>
      </header>

      <div className="chat-scroll">
        {favourites === null && <p className="dashboard-note">Loading…</p>}
        {favourites !== null && favourites.length === 0 && (
          <p className="dashboard-empty">
            Your shelf is empty right now. Find a book or video you like and hit Save — it'll live here.
          </p>
        )}
        {favourites !== null && favourites.length > 0 && (
          <div className="favourites-shelf">
            {favourites.map((f) => (
              <div key={f.id} className="rec-card">
                <div className={`rec-card-cover rec-card-cover--${f.type ?? 'book'}`}>
                  <span>{f.type === 'video' ? '🎬' : '📖'}</span>
                  <span className="rec-card-cover-tag">{f.type === 'video' ? 'Video' : 'Book'}</span>
                </div>
                <div className="rec-card-body">
                  <div className="rec-card-title">{f.title ?? '(no longer available)'}</div>
                  {f.synopsis && <div className="rec-card-reason">{f.synopsis}</div>}
                  <div className="rec-card-actions">
                    {canSpeak && f.title && (
                      <button className="rec-action rec-action--secondary" onClick={() => onSpeak(`${f.title}. ${f.synopsis ?? ''}`)}>
                        <span className="rec-action-icon"><SpeakerIcon /></span>
                        <span>Listen</span>
                      </button>
                    )}
                    <button
                      className="rec-action rec-action--secondary"
                      onClick={() => handleRemove(f.id)}
                      disabled={busyId === f.id}
                    >
                      <span className="rec-action-icon"><RemoveIcon /></span>
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
