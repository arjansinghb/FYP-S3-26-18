// ---------------------------------------------------------------------------
// PLACEHOLDER "brain" for the prototype.
//
// This is a temporary stand-in so the chat feels alive before the real AI is
// connected. It just looks for a few keywords and returns a canned, friendly,
// age-appropriate reply. There is NO real intelligence here yet.
//
// Later this whole file gets replaced by a call to the FastAPI backend, which
// talks to the LLM (OpenAI/Anthropic) and the curated content database. The
// rest of the app won't need to change — it already calls getReply() and just
// shows whatever comes back.
// ---------------------------------------------------------------------------

const RULES = [
  {
    match: ['hi', 'hello', 'hey', 'yo'],
    reply: "Hi there! I'm so happy you're here. What are you in the mood for — a book or a video?",
  },
  {
    match: ['scared', 'scary', 'sad', 'upset', 'cry'],
    reply: "Aw, that's okay. How about something cosy and gentle? I know a sweet story about a little bear who can't sleep.",
  },
  {
    match: ['funny', 'laugh', 'silly', 'joke'],
    reply: "Ooh, I love funny! Try 'The Dragon Who Couldn't Stop Sneezing' — it made me giggle so much!",
  },
  {
    match: ['dinosaur', 'dino', 't-rex'],
    reply: "Dinosaurs are the best! There's a cool picture book called 'Ricky the Rock That Roared'. Want a video about them too?",
  },
  {
    match: ['space', 'planet', 'star', 'moon', 'rocket'],
    reply: "Blast off! 🚀 I found a short, colourful video about how rockets fly. Should I show you a space book as well?",
  },
  {
    match: ['animal', 'dog', 'cat', 'lion', 'tiger'],
    reply: "Animals are so much fun! How about a story about a brave little lion who's afraid of the dark?",
  },
  {
    match: ['book', 'read', 'story'],
    reply: "Great choice! Do you want something funny, exciting, or cosy? Tell me a little more and I'll find the perfect one.",
  },
  {
    match: ['video', 'watch', 'movie', 'show'],
    reply: "Nice! What do you like — animals, space, or how things work? I'll find a fun, safe video for you.",
  },
]

const FALLBACKS = [
  "Ooh, tell me more! Do you like funny stories, exciting ones, or something cosy?",
  "That sounds interesting! Would you like a book or a video about that?",
  "I'm thinking... can you tell me one thing you really love? Then I'll find something just right.",
]

// getReply(text) -> a friendly placeholder reply string.
export function getReply(text) {
  const lower = ` ${text.toLowerCase()} `
  for (const rule of RULES) {
    if (rule.match.some((word) => lower.includes(` ${word}`))) {
      return rule.reply
    }
  }
  // no keyword matched — pick a rotating fallback
  return FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)]
}
