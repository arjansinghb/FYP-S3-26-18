// CH11 (Listen to Recommendation, TTS via avatar/character) — dev-session
// 2026-08-21 chat redesign. Was previously a private handleListen() inside
// RecommendationCard.tsx, called independently per-card with no way for
// anything else (like ChatScreen's big companion avatar) to know whether
// the avatar is "talking" right now. Centralized here so ChatScreen can
// drive the avatar's visual state (idle/thinking/speaking) off the same
// speak() calls RecommendationCard's Listen button and the bot's own
// message auto-narration both go through.
import { useCallback, useState } from 'react'

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const speak = useCallback(
    (text: string) => {
      if (!supported) return
      // Cancel whatever's mid-utterance rather than overlapping/queueing —
      // a child mashing "Listen" on several cards should hear the latest
      // one, not a backlog.
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.onstart = () => setSpeaking(true)
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      window.speechSynthesis.speak(utterance)
    },
    [supported]
  )

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  return { speak, stop, speaking, supported }
}
