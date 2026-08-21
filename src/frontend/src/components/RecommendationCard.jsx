import { useState } from 'react'

// One recommended book/video (CH08/CH09) with its explanation (CH10) and the
// child's actions: details (CH14), watch video (CH12), save (CH15), feedback (CH17).
export default function RecommendationCard({ item, onDetails, onWatch, onSave, onFeedback }) {
  const [saved, setSaved] = useState(false)
  const [vote, setVote] = useState(null)

  function save() {
    setSaved(true)
    onSave(item)
  }
  function feedback(liked) {
    setVote(liked ? 'up' : 'down')
    onFeedback(item, liked)
  }

  return (
    <div className="rec-card">
      <h3 className="rec-title">{item.type === 'book' ? '📚' : '🎬'} {item.title}</h3>
      <p className="rec-why">{item.explanation}</p>
      <div className="rec-btns">
        <button onClick={() => onDetails(item)}>Details</button>
        {item.type === 'video' && <button onClick={() => onWatch(item)}>▶ Watch</button>}
        <button className={saved ? 'on' : ''} onClick={save}>{saved ? '❤️ Saved' : '🤍 Save'}</button>
        <button className={vote === 'up' ? 'on' : ''} onClick={() => feedback(true)} aria-label="I like it">👍</button>
        <button className={vote === 'down' ? 'on' : ''} onClick={() => feedback(false)} aria-label="Not for me">👎</button>
      </div>
    </div>
  )
}
