// UV01 (View Landing Page) + UV02 (View App Information) + UV03 (View
// Subscription Plans) + UV04 (View User Reviews) — one scrolling marketing
// page rather than four separate routes. Reasonable simplification for an
// unregistered-visitor flow this small; split into real routes later if the
// team wants deep-linkable sections.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ScrollTopSentinel, useReveal, useScrolled } from '../hooks/useReveal'

const FEATURES = [
  { icon: '💬', title: 'A conversation, not a search box', body: 'Your child describes what they\'re in the mood for — StoryBuddy asks a friendly follow-up question if it needs to, then suggests a small, explained set of picks.' },
  { icon: '🛡️', title: 'A closed, pre-vetted catalogue', body: 'Every book and video comes from a curated list reviewed by a human moderator first — never a live, open web search.' },
  { icon: '👨‍👩‍👧', title: 'A dashboard for parents', body: 'See what your child asked and was shown, flag anything, and adjust settings — without watching every conversation.' },
  { icon: '🎯', title: 'Age-band tailored', body: 'Vocabulary, complexity, and even which items surface at all are tuned for ages 5-8 vs 9-12.' },
]

export default function LandingPage() {
  const scrolled = useScrolled()

  return (
    <div className="landing">
      <ScrollTopSentinel />
      <header className={`landing-nav ${scrolled ? 'landing-nav--scrolled' : ''}`}>
        <div className="landing-brand">📚 StoryBuddy</div>
        <nav>
          <Link to="/login" className="landing-nav-link">Log in</Link>
          <Link to="/signup" className="landing-nav-cta">Sign up free</Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">For families · ages 5–12</p>
          <h1>Book & video recommendations your kid asks for — literally.</h1>
          <p className="landing-subtitle">
            A conversational companion for ages 5-12, backed by a curated, parent-visible catalogue.
            No search box. No open web. No surprises.
          </p>
          <div className="landing-hero-actions">
            <Link to="/signup" className="big-button">Create a free account</Link>
            <Link to="/chat" className="link-button">I'm a kid, take me to chat →</Link>
          </div>
        </div>
        <HeroIllustration />
      </section>

      <section className="landing-section" id="features">
        <Reveal as="h2">What StoryBuddy does</Reveal>
        <div className="feature-grid">
          {FEATURES.map((f, i) => (
            <Reveal as="div" className="feature-card" key={f.title} delayMs={i * 90}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="landing-section" id="pricing">
        <Reveal as="h2">Free vs Premium</Reveal>
        <div className="pricing-grid">
          <Reveal as="div" className="pricing-card">
            <h3>Free</h3>
            <p className="pricing-price">$0</p>
            <ul>
              <li>1 child profile</li>
              <li>Unlimited chat — never gated</li>
              <li>Basic recommendations + reasons</li>
              <li>5 saved favourites</li>
              <li>Basic activity log</li>
            </ul>
          </Reveal>
          <Reveal as="div" className="pricing-card pricing-card--premium" delayMs={120}>
            <h3>Premium</h3>
            <p className="pricing-price">Ask your admin 😉</p>
            <ul>
              <li>Up to 4 child profiles</li>
              <li>Unlimited chat — never gated</li>
              <li>Richer recommendation explanations</li>
              <li>Unlimited saved favourites</li>
              <li>Full activity history + trend insights</li>
              <li>Multi-child comparison</li>
            </ul>
          </Reveal>
        </div>
        <p className="pricing-note">
          The chat experience is never limited on Free — Premium only adds parent-side depth and convenience.
        </p>
      </section>

      <section className="landing-section" id="reviews">
        <Reveal as="h2">What parents say</Reveal>
        <Reveal as="div" className="reviews-empty">
          <p>No reviews yet — StoryBuddy is brand new. Check back soon!</p>
        </Reveal>
      </section>

      <footer className="landing-footer">
        <p>FYP-26-S3-18 — a student project, not a live commercial product.</p>
      </footer>
    </div>
  )
}

// Scroll-reveal wrapper (see hooks/useReveal.ts) — `as` picks the rendered
// tag so this can wrap a heading or a card without an extra nesting div.
function Reveal({
  as: Tag,
  className = '',
  delayMs = 0,
  children,
}: {
  as: 'div' | 'h2'
  className?: string
  delayMs?: number
  children: ReactNode
}) {
  const { ref, visible } = useReveal<HTMLDivElement>()
  return (
    <Tag
      ref={ref as never}
      className={`reveal ${visible ? 'reveal--visible' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </Tag>
  )
}

// A hand-built illustration (books + an embedded-video card) rather than a
// stock icon or a text-only hero — the single biggest lever for not reading
// as an AI-template landing page (see index.css's redesign-pass docstring
// above the parent :root tokens). Uses the child theme's accent palette
// (--cherry/--sun/--grass/--sky) so the marketing page visually previews
// the product's actual colour world, not a separate corporate-blue one.
// Gets a slow idle float (CSS) so the hero doesn't read as a static screenshot.
function HeroIllustration() {
  return (
    <svg
      className="landing-hero-illustration"
      viewBox="0 0 380 320"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A stack of books beside a video card with a play button"
    >
      <defs>
        <radialGradient id="hero-mesh" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="var(--sky, #2fb0c9)" stopOpacity="0.35" />
          <stop offset="45%" stopColor="var(--p-primary)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--sun, #ffc53d)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle className="hero-illo-backdrop" cx="190" cy="165" r="148" />

      <g className="hero-illo-books">
        <rect x="55" y="222" width="190" height="36" rx="8" transform="rotate(-4 150 240)" className="hero-illo-book hero-illo-book--1" />
        <rect x="75" y="190" width="168" height="34" rx="8" transform="rotate(3 159 207)" className="hero-illo-book hero-illo-book--2" />
        <rect x="68" y="158" width="150" height="32" rx="8" transform="rotate(-6 143 174)" className="hero-illo-book hero-illo-book--3" />
      </g>

      <g className="hero-illo-video" transform="rotate(7 250 110)">
        <rect x="165" y="40" width="170" height="120" rx="20" className="hero-illo-video-card" />
        <circle cx="250" cy="100" r="30" className="hero-illo-play-ring" />
        <path d="M242 86 L266 100 L242 114 Z" className="hero-illo-play-triangle" />
      </g>

      <circle cx="60" cy="90" r="6" className="hero-illo-sparkle hero-illo-sparkle--1" />
      <circle cx="330" cy="200" r="8" className="hero-illo-sparkle hero-illo-sparkle--2" />
      <circle cx="300" cy="60" r="5" className="hero-illo-sparkle hero-illo-sparkle--3" />
    </svg>
  )
}
