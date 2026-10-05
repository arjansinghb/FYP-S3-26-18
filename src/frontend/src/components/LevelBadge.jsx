import { StarIcon } from '../icons'

// What each level means, in words a child can read. The parent sees a
// different, more precise descriptor (backend profile.LEVEL_INFO).
const CHILD_TEXT = {
  explorer: 'Tell Pip what you noticed in a book or video.',
  adventurer: 'Tell Pip what happened, and why it mattered.',
  storyteller: 'Tell the whole story your own way, and what you think of it!',
}
const ORDER = ['explorer', 'adventurer', 'storyteller']

const RING_R = 14
const RING_LEN = 2 * Math.PI * RING_R

// CH22 — compact version for the top bar: the level number inside a ring that
// fills toward the next level, with the level's name beside it. Counts
// confirmations only; nothing here can reveal that an explanation was ever
// declined.
export function LevelChip({ level }) {
  if (!level) return null
  const top = !level.next_level
  const rank = ORDER.indexOf(level.level) + 1
  const share = top ? 1 : level.progress / level.needed
  const hint = top
    ? `Level ${rank} of ${ORDER.length}: you reached the top level`
    : `Level ${rank} of ${ORDER.length}: ${level.progress} of ${level.needed} to ${level.next_label}`
  return (
    <span className="level-chip" data-level={level.level} title={hint} aria-label={hint}>
      <svg className="level-ring" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="level-ring-track" cx="18" cy="18" r={RING_R} />
        <circle
          className="level-ring-fill" cx="18" cy="18" r={RING_R} transform="rotate(-90 18 18)"
          strokeDasharray={`${share * RING_LEN} ${RING_LEN}`}
        />
        <text x="18" y="23" textAnchor="middle">{rank}</text>
      </svg>
      <span className="level-chip-text">
        <span className="level-chip-name">{level.label}</span>
        <span className="level-chip-sub" aria-hidden="true">
          {top ? (
            <><StarIcon width={11} height={11} filled /> Top level</>
          ) : (
            <>{level.progress}/{level.needed}<span className="level-chip-next"> to {level.next_label}</span></>
          )}
        </span>
      </span>
    </span>
  )
}

// CH22 — detail version for the top of the Library.
export function LevelCard({ level }) {
  if (!level) return null
  const current = ORDER.indexOf(level.level)
  const top = !level.next_level
  return (
    <section className="level-card" data-level={level.level} aria-label="Your explorer level">
      <div className="level-card-main">
        <p className="level-card-kicker">Your level</p>
        <h3 className="level-card-name">{level.label}</h3>
        <p className="level-card-text">{CHILD_TEXT[level.level]}</p>
        <p className="level-card-next">
          {top ? (
            <span className="level-card-next-line">You made it all the way to the top. Keep telling Pip your stories!</span>
          ) : (
            <>
              <span className="level-card-next-line level-card-next-line--lead">
                {level.progress} of {level.needed} to become {/^[aeiou]/i.test(level.next_label) ? 'an' : 'a'} {level.next_label}
              </span>
              <span className="level-card-next-line">Tell Pip about something in your library.</span>
            </>
          )}
        </p>
      </div>
      <ol className="level-steps">
        {ORDER.map((key, i) => (
          <li key={key} data-level={key} className={`level-step ${i < current ? 'level-step--done' : ''} ${i === current ? 'level-step--now' : ''}`}>
            <span className="level-step-dot">{i < current ? '✓' : i + 1}</span>
            <span className="level-step-name">{key[0].toUpperCase() + key.slice(1)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
