import { getAvatar } from '../avatars'
import RecommendationCard from './RecommendationCard'
import type { RecommendationOut, Sender } from '../types'

export interface DisplayMessage {
  id: string
  sender: Sender
  text: string
  recommendations?: RecommendationOut[]
  canShowAlternative?: boolean
}

interface Props {
  message: DisplayMessage
  avatarId: string | null
  childId: string
  token: string
  onRequestAlternative?: () => void
  alternativeLoading?: boolean
}

export default function ChatBubble({
  message,
  avatarId,
  childId,
  token,
  onRequestAlternative,
  alternativeLoading,
}: Props) {
  const isBot = message.sender === 'bot'
  const avatar = getAvatar(avatarId)

  return (
    <div className={`bubble-row ${isBot ? 'bubble-row--bot' : 'bubble-row--child'}`}>
      {isBot && (
        <div className="bubble-avatar" style={{ background: avatar.color }}>
          {avatar.icon}
        </div>
      )}
      <div className="bubble-stack">
        <div className={`bubble ${isBot ? 'bubble--bot' : 'bubble--child'}`}>{message.text}</div>

        {message.recommendations && message.recommendations.length > 0 && (
          <div className="rec-card-list">
            {message.recommendations.map((rec) => (
              <RecommendationCard key={rec.item_id} rec={rec} childId={childId} token={token} />
            ))}
            {message.canShowAlternative && (
              <button className="pill-button pill-button--wide" onClick={onRequestAlternative} disabled={alternativeLoading}>
                {alternativeLoading ? 'Thinking…' : '🔄 Show me something else'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
