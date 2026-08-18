// Child-facing API calls — see src/backend/app/routers/*.py for the source of
// truth on request/response shapes. Parent-facing calls live in parentClient.ts.
import { ApiError, request } from './http'
import type {
  BotReply,
  ChatMessage,
  ChatSession,
  ChildLoginResult,
  ChildProfilePublic,
  Favourite,
  RecommendationOut,
} from '../types'

// CH01/CH02 — Enter Linking Code / Log In (PIN). Same endpoint; `activated`
// in the response tells the caller which of the two just happened.
export function childLogin(childId: string, pin: string): Promise<ChildLoginResult> {
  return request(`/children/${childId}/login`, { method: 'POST', body: { pin } })
}

// CH04 — Start Chat Session.
export function startSession(childId: string, token: string): Promise<ChatSession> {
  return request(`/children/${childId}/sessions`, { method: 'POST', token })
}

// CH06 through CH10 — send a message, get back the bot's reply (possibly a
// clarifying question, possibly recommendations).
export function sendMessage(sessionId: string, token: string, text: string): Promise<BotReply> {
  return request(`/sessions/${sessionId}/messages`, { method: 'POST', token, body: { text } })
}

// CH18 — Request Alternative Recommendation ("something else").
export function requestAlternative(sessionId: string, token: string): Promise<BotReply> {
  return request(`/sessions/${sessionId}/alternative`, { method: 'POST', token })
}

// CH05 — End Chat Session.
export function endSession(sessionId: string, token: string): Promise<ChatSession> {
  return request(`/sessions/${sessionId}/end`, { method: 'POST', token })
}

// Fetches a session's transcript — used to resume/render history, e.g. after
// a page reload (not its own PRD use case; see the backend router's docstring).
export function getSessionMessages(sessionId: string, token: string): Promise<ChatMessage[]> {
  return request(`/sessions/${sessionId}/messages`, { token })
}

// CH15 — Save Favourite.
export function saveFavourite(childId: string, token: string, itemId: string): Promise<Favourite> {
  return request(`/children/${childId}/favourites`, {
    method: 'POST',
    token,
    body: { catalogue_item_id: itemId },
  })
}

// CH16 — View Saved Favourites.
export function listFavourites(childId: string, token: string): Promise<Favourite[]> {
  return request(`/children/${childId}/favourites`, { token })
}

// CH17 — Give Feedback on Recommendation.
export function giveFeedback(itemId: string, token: string, liked: boolean): Promise<void> {
  return request(`/recommendations/${itemId}/feedback`, {
    method: 'POST',
    token,
    body: { item_id: itemId, liked },
  })
}

// CH19/CH20 — Choose Avatar / Edit Avatar (same endpoint).
export function chooseAvatar(token: string, avatarId: string): Promise<ChildProfilePublic> {
  return request(`/children/me/avatar`, { method: 'PATCH', token, body: { avatar_id: avatarId } })
}

export { ApiError }
export type { RecommendationOut }
