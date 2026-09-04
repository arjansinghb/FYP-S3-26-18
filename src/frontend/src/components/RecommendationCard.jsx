import { useState } from 'react'
import { BookIcon, HeartIcon, PlayIcon, ThumbsDownIcon, ThumbsUpIcon, VideoIcon } from '../icons'

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

  const TypeIcon = item.type === 'book' ? BookIcon : VideoIcon

  return (
    <div className="rec-card">
      {item.thumbnail && <img className="rec-cover" src={item.thumbnail} alt="" />}
      <h3 className="rec-title"><TypeIcon className="rec-type-icon" /> {item.title}</h3>
      <p className="rec-why">{item.explanation}</p>
      <div className="rec-btns">
        <button onClick={() => onDetails(item)}>Details</button>
        {item.type === 'video' && <button onClick={() => onWatch(item)}><PlayIcon width={16} height={16} /> Watch</button>}
        <button className={saved ? 'on' : ''} onClick={save}>
          <HeartIcon width={16} height={16} filled={saved} /> {saved ? 'Saved' : 'Save'}
        </button>
        <button className={vote === 'up' ? 'on' : ''} onClick={() => feedback(true)} aria-label="I like it">
          <ThumbsUpIcon width={16} height={16} filled={vote === 'up'} />
        </button>
        <button className={vote === 'down' ? 'on' : ''} onClick={() => feedback(false)} aria-label="Not for me">
          <ThumbsDownIcon width={16} height={16} filled={vote === 'down'} />
        </button>
      </div>
    </div>
  )
}
