import { useState } from 'react'
import { BookIcon, HeartIcon, PlayIcon, StarIcon, ThumbsDownIcon, ThumbsUpIcon, VideoIcon } from '../icons'
import { curateTitle } from '../curate'

// One recommended book/video (CH08/CH09) with its explanation (CH10) and the
// child's actions: details (CH14), watch video (CH12), save (CH15), feedback (CH17).
// `topPick` — only set true on the first of 2+ cards: Pip leads with one
// answer and offers an alternative, not two equal, undifferentiated
// options — same reason a person recommending two books still has one
// they'd hand you first. No invented score, just which one comes first.
export default function RecommendationCard({ item, topPick, onDetails, onWatch, onSave, onFeedback }) {
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [vote, setVote] = useState(null)

  // Was optimistic: `setSaved(true)` fired before `onSave`'s promise even
  // settled, so a real failure (the free-favourites-cap 403, a dropped
  // request) still showed "Saved!" — a false confirmation on a product
  // whose whole premise is a parent trusting what it tells their kid.
  async function save() {
    setSaving(true)
    setSaveError('')
    try {
      await onSave(item)
      setSaved(true)
    } catch (err) {
      setSaveError(err?.message || "Couldn't save that — try again?")
    } finally {
      setSaving(false)
    }
  }
  function feedback(liked) {
    setVote(liked ? 'up' : 'down')
    onFeedback(item, liked)
  }

  const TypeIcon = item.type === 'book' ? BookIcon : VideoIcon

  return (
    <div className={`rec-card ${topPick ? 'rec-card--top' : ''}`}>
      {topPick && (
        <p className="rec-top-badge"><StarIcon width={12} height={12} filled /> Pip's top pick</p>
      )}
      {item.thumbnail && <img className="rec-cover" src={item.thumbnail} alt="" />}
      <h3 className="rec-title"><TypeIcon className="rec-type-icon" /> <span className="rec-title-text">{curateTitle(item.title)}</span></h3>
      {/* Real catalogue tags (CM10), not an invented "98% match" score —
          the data only supports a genre label, not a fabricated number. */}
      {item.genres?.length > 0 && (
        <div className="rec-tags">
          {item.genres.slice(0, 2).map((g) => <span className="rec-tag" key={g}>{g}</span>)}
        </div>
      )}
      <p className="rec-why">{item.explanation}</p>
      <div className="rec-btns">
        <button onClick={() => onDetails(item)}>Details</button>
        {item.type === 'video' && <button onClick={() => onWatch(item)}><PlayIcon width={16} height={16} /> Watch</button>}
        <button className={saved ? 'on' : ''} onClick={save} disabled={saving || saved}>
          <HeartIcon width={16} height={16} filled={saved} /> {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
        </button>
        {/* Labelled, not icon-only — an unlabelled thumbs pair reads as a
            generic content-rating widget bolted onto the chat rather than
            something Pip is asking. */}
        <button className={vote === 'up' ? 'on' : ''} onClick={() => feedback(true)}>
          <ThumbsUpIcon width={16} height={16} filled={vote === 'up'} /> Loved it
        </button>
        <button className={vote === 'down' ? 'on' : ''} onClick={() => feedback(false)}>
          <ThumbsDownIcon width={16} height={16} filled={vote === 'down'} /> Not for me
        </button>
      </div>
      {saveError && <p className="rec-error">{saveError}</p>}
    </div>
  )
}
