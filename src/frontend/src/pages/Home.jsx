import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar, { AVATAR_COLORS } from '../components/Avatar'
import { getPublicSite, getPublicPlans, getPublicCatalogueSample } from '../api'
import { curateTitle } from '../curate'
import {
  AlertIcon, BookIcon, ChatIcon, CheckIcon, CompassIcon, MicIcon, QuoteIcon, ShieldIcon,
  SparkleIcon, UsersIcon, VideoIcon,
} from '../icons'
import { ClusterBookGlyph, ClusterPlayGlyph, ClusterSparkleGlyph } from '../illustrations'
import './landing.css'

// UV02 — how the app works. One spotlighted idea (the actual interaction
// model) plus three supporting points, not four peer cards — see
// landing.css's ".how-*" rules for why this isn't a bento grid anymore.
const SUPPORTING_FEATURES = [
  { icon: ShieldIcon, title: 'Always safe', text: 'Every book and video comes from a curated, pre-vetted catalogue. It never pulls from open, unfiltered sources.' },
  { icon: SparkleIcon, title: 'Personalised', text: "Matches each child's age band and interests." },
  { icon: UsersIcon, title: 'Parents in control', text: 'See activity, manage profiles, set limits.' },
]

// The actual gap this product fills — existing tools force a choice between
// a curated library (safe, generic) and an algorithm (personalised, opaque).
const OLD_WAYS = [
  { icon: ShieldIcon, title: 'A curated library alone', text: "Safe, but it's just a static shelf. It has no sense of what this kid wants today." },
  { icon: SparkleIcon, title: 'A search engine or open algorithm', text: 'Personalised, but it pulls from the whole internet. No one vetted what it might surface.' },
]
const PIP_ANSWER = { icon: CompassIcon, title: 'Pip', text: 'Both. Recommendations only ever come from a pre-vetted catalogue, shaped by an actual conversation, not a keyword match.' }

const FAQS = [
  { icon: ShieldIcon, q: 'Is it actually safe for my kid to talk to?', a: "Pip can only ever recommend books and videos from a catalogue that's been reviewed and approved by a human moderator first, never a live, open search. Your child's messages are also screened before Pip responds." },
  { icon: UsersIcon, q: 'What age is this for?', a: 'Ages 5–12, split into two bands (5–8 and 9–12) so the vocabulary, topics, and reading level actually match your child, not a one-size-fits-all list.' },
  { icon: ChatIcon, q: 'Can I see what my child has been chatting about?', a: 'Yes. The parent dashboard shows the full activity log, saved favourites, and lets you flag anything for review or adjust safety settings per child, any time.' },
  { icon: CheckIcon, q: 'Do I have to pay?', a: 'No. The core chat experience is free forever, for one child profile. Premium adds more child profiles, unlimited favourites, and activity insights, but it never gates the chatbot itself.' },
]

// UV04 — user reviews. Round 2 on this section, per Kiefer's explicit
// call: he wants the space visually filled, not an empty state — but the
// first version's failure mode was specific named people ("Sarah, mum of
// two") with quotes and star ratings, which reads as real social proof at
// a glance no matter how small the disclaimer underneath is. This version
// keeps the same honesty rule (no invented person, no fabricated rating)
// but fills the section: the "name" slot is a plain label ("Example
// parent reaction"), never a name, and the section has a visible badge
// ABOVE the cards, not fine print below them, saying these aren't real
// reviews yet. No star ratings — a 4.5-star average would be exactly the
// kind of fabricated stat the brief's own banned-pattern list rules out.
const REVIEWS = [
  { text: 'My 6-year-old asks for "reading time" now instead of screen time — that alone sold me.' },
  { text: "I can actually see what my kid's been chatting about and reading, without hovering over her shoulder." },
  { text: 'The voice avatar makes it feel like talking to a character, not typing into a search box.' },
]

// "See Pip in action" — used to call the real chat endpoint live, on every
// visit (Kiefer's own earlier ask), so a visitor saw a genuinely fresh
// answer. Switched to a frozen example on his explicit follow-up call: this
// is landing-page marketing copy, not a product screen, and it doesn't need
// a live backend round-trip (or the load-time wait/skeleton that came with
// one) just to show how a reply looks. Still real, not invented — this is
// an actual response captured from the real running backend
// (`POST /api/chat`, `text-embedding-3-small` retrieval + `gpt-4o-mini`)
// for this exact question, against a real approved catalogue item
// ("Dinosaur Bob and His Adventures with the Family Lazardo" — real Google
// Books cover/synopsis, CM03-imported and CM07-approved same as every other
// catalogue entry). It just isn't re-fetched on every page load anymore.
const DEMO_EXCHANGE = {
  prompt: 'Do you have a funny book about dinosaurs?',
  reply: "Ooh, I found something! How about the book 'Dinosaur Bob and His Adventures with the Family Lazardo'? It's an adventure with a dinosaur that could be funny. Want me to find another one?",
  recommendation: {
    type: 'book',
    title: 'Dinosaur Bob and His Adventures with the Family Lazardo',
    explanation: "It's an adventure with a dinosaur that could be funny.",
    thumbnail: 'http://books.google.com/books/content?id=nvBUDgAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  },
}

export default function Home() {
  const [site, setSite] = useState({ site_title: 'Pip', tagline: 'Safe, age-appropriate books & videos for kids', announcement: '' })
  const [plans, setPlans] = useState({
    currency: 'SGD', premium_monthly_price: 9.9, premium_annual_price: 99.0,
    ultra_monthly_price: 19.9, ultra_annual_price: 199.0,
  })
  const [catalogue, setCatalogue] = useState([])

  // A brief, one-time "Pip talks" moment on load — this is a voice-chat
  // product, and the hero is the one place that should actually demonstrate
  // that rather than showing a permanently silent mascot (see the design
  // critique: `speaking` was hardcoded false everywhere).
  const [heroSpeaking, setHeroSpeaking] = useState(false)
  useEffect(() => {
    const start = setTimeout(() => setHeroSpeaking(true), 700)
    const stop = setTimeout(() => setHeroSpeaking(false), 2600)
    return () => { clearTimeout(start); clearTimeout(stop) }
  }, [])

  // Same moment, repeated once when the closing CTA's avatar actually
  // scrolls into view, instead of firing (invisibly) on page load. Polled
  // on an interval rather than IntersectionObserver — deliberate: this
  // page is long, and a plain interval check is trivial to reason about
  // and to test, with no observer lifecycle to get wrong.
  const finalAvatarRef = useRef(null)
  const finalTriggeredRef = useRef(false)
  const [finalSpeaking, setFinalSpeaking] = useState(false)
  useEffect(() => {
    const check = () => {
      if (finalTriggeredRef.current) return
      const el = finalAvatarRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const visible = rect.top < window.innerHeight * 0.85 && rect.bottom > 0
      if (visible) {
        finalTriggeredRef.current = true
        setFinalSpeaking(true)
        setTimeout(() => setFinalSpeaking(false), 1900)
      }
    }
    check()
    const id = setInterval(check, 250)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    getPublicSite().then(setSite).catch(() => {})
    getPublicPlans().then(setPlans).catch(() => {})
    getPublicCatalogueSample(12).then(setCatalogue).catch(() => {}) // 12 is the endpoint's own cap (public.py)
  }, [])

  // "See Pip in action" — plays DEMO_EXCHANGE (a frozen real backend
  // response, see its own comment above) out as a short beat-by-beat
  // sequence instead of dumping the whole card in at once — 0: nothing
  // yet, 1: the child's question, 2: Pip "thinking" (reuses the same dots
  // the real chat screen shows mid-request), 3: Pip's reply, 4: the
  // recommendation card, which gets its own "camera push-in" treatment
  // (see .demo-card-cover's CSS) rather than just fading in like the
  // bubbles. Same visibility-poll pattern as `finalSpeaking` above (this
  // codebase's deliberate IntersectionObserver alternative), not a second
  // observer — no network round-trip left to wait on, so nothing to gate
  // this on beyond scrolling into view.
  const demoSectionRef = useRef(null)
  const demoTriggeredRef = useRef(false)
  const [demoStage, setDemoStage] = useState(0)
  useEffect(() => {
    const timers = []
    const check = () => {
      if (demoTriggeredRef.current) return
      const el = demoSectionRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.top < window.innerHeight * 0.8 && rect.bottom > 0) {
        demoTriggeredRef.current = true
        // Stage 4 (the book card) used to follow the reply by only 600ms —
        // not enough time to actually read the reply before the card
        // yanked focus away (Kiefer's own catch, live). Reply now gets a
        // real ~2s beat to be read on its own before the card appears.
        timers.push(setTimeout(() => setDemoStage(1), 200))
        timers.push(setTimeout(() => setDemoStage(2), 1100))
        timers.push(setTimeout(() => setDemoStage(3), 2500))
        timers.push(setTimeout(() => setDemoStage(4), 4500))
      }
    }
    check()
    const id = setInterval(check, 250)
    return () => { clearInterval(id); timers.forEach(clearTimeout) }
  }, [])


  const money = (n) => `${plans.currency} ${Number(n).toFixed(2)}`

  return (
    <div className="landing">
      {site.announcement && <div className="announce">{site.announcement}</div>}

      <nav className="landing-nav">
        <div className="landing-brand">
          <Avatar speaking={false} mood="happy" />
          <span>{site.site_title.split('—')[0].trim() || 'Pip'}</span>
        </div>
        <Link className="landing-nav-cta" to="/parent">Parent sign up</Link>
      </nav>

      <main>
        {/* UV01 — hero / landing */}
        <header className="hero">
          <div className="hero-copy">
            <h1>Stories your<br />kid actually<br /><span className="hero-accent">asks for.</span></h1>
            <p className="hero-tag">{site.tagline}</p>
            <div className="hero-cta">
              <Link className="cta cta-child" to="/child"><MicIcon width={18} height={18} /> Talk to Pip</Link>
              <Link className="cta cta-parent" to="/parent"><UsersIcon width={18} height={18} /> Parent sign up</Link>
            </div>
          </div>
          {/* A loose cluster of flat illustration pieces (not the app's own
              UI icon set — see illustrations.jsx), deliberately un-gridded
              so it reads as illustration, not a UI component. Reverted back
              to this from a real-book-cover version per Kiefer's explicit
              ask — the covers are still used lower down (catalogue peek,
              the "See Pip in action" card), just not in the hero itself. */}
          <div className="hero-visual">
            <div className="hero-cluster">
              <div className="cluster-piece cluster-avatar"><Avatar speaking={heroSpeaking} mood="happy" /></div>
              <div className="cluster-piece cluster-book"><ClusterBookGlyph width={30} height={25} /></div>
              <div className="cluster-piece cluster-video"><ClusterPlayGlyph width={26} height={26} /></div>
              <div className="cluster-piece cluster-star"><ClusterSparkleGlyph width={24} height={24} /></div>
              <div className="cluster-piece cluster-sparkle"><SparkleIcon width={20} height={20} /></div>
              <p className="cluster-caption">"Want a funny book about dinosaurs?"</p>
            </div>
          </div>
        </header>

        {/* UV02 — app information: one spotlighted idea + a plain supporting
            list, not four identical bordered cards. */}
        <section className="section section--tint">
          <h2>How it works</h2>
          <div className="how-grid">
            <div className="how-spotlight">
              <div className="how-spotlight-icon"><MicIcon width={26} height={26} /></div>
              <h3>Just talk</h3>
              <p>Kids simply speak to Pip. No typing needed. Pip listens and replies out loud, like a real conversation.</p>
            </div>
            <ul className="how-list">
              {SUPPORTING_FEATURES.map((f) => (
                <li key={f.title}>
                  <div className="how-list-icon"><f.icon width={20} height={20} /></div>
                  <div>
                    <h4>{f.title}</h4>
                    <p>{f.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* "See Pip in action" — DEMO_EXCHANGE (see its own comment above)
            plays out as a beat-by-beat sequence once this section scrolls
            into view. No network call and nothing to wait on any more —
            Kiefer's explicit follow-up call, this is landing-page marketing
            copy, not a product screen, so it doesn't need a live backend
            round-trip (or the earlier loading skeleton that came with
            waiting on one) just to show what a reply looks like. */}
        <section className="section" ref={demoSectionRef}>
          <h2>See Pip in action</h2>
          <p className="section-lead">A real exchange with Pip — a real question, matched to a real, moderator-approved catalogue item.</p>
          <div className="demo-chat">
            {demoStage >= 1 && (
              <div className="demo-bubble demo-bubble-child demo-beat-in">"{DEMO_EXCHANGE.prompt}"</div>
            )}
            {demoStage >= 2 && (
              <div className="demo-row demo-beat-in">
                <Avatar speaking={demoStage === 3} mood={demoStage >= 3 ? 'happy' : 'idle'} />
                <div className="demo-bubble demo-bubble-pip">
                  {demoStage === 2 ? (
                    <span className="demo-dots" aria-label="Pip is thinking"><span></span><span></span><span></span></span>
                  ) : DEMO_EXCHANGE.reply}
                </div>
              </div>
            )}
            {demoStage >= 4 && (
              <div className="demo-card demo-card-in">
                {DEMO_EXCHANGE.recommendation.thumbnail && (
                  <div className="demo-card-cover-frame">
                    <img className="demo-card-cover demo-card-cover-zoom" src={DEMO_EXCHANGE.recommendation.thumbnail} alt="" />
                  </div>
                )}
                <div className="demo-card-body">
                  <span className="catalogue-type">
                    {DEMO_EXCHANGE.recommendation.type === 'book' ? <BookIcon width={14} height={14} /> : <VideoIcon width={14} height={14} />}
                    {' '}{DEMO_EXCHANGE.recommendation.type}
                  </span>
                  <h3>{curateTitle(DEMO_EXCHANGE.recommendation.title)}</h3>
                  <p>{DEMO_EXCHANGE.recommendation.explanation}</p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* A peek at the real catalogue — not stock photos or invented
            titles, whatever's actually moderator-approved right now
            (app/routers/public.py's catalogue-sample). Only rendered once
            real items come back, so an empty/fresh catalogue doesn't show a
            broken-looking empty grid.
            An auto-scrolling shelf, not a static grid — the Epic! principle
            that actually transfers here isn't its visual style, it's that
            a real, varied catalogue should feel like it keeps going, not
            stop at a fixed 10-tile block. CSS-only continuous scroll (no
            JS animation loop to get wrong), pauses on hover/focus so a
            title is actually readable once you look at it, and the track
            is the real list duplicated once — an implementation detail for
            a seamless loop, not a claim of more content than exists (see
            CatalogueCard below; the duplicate copy is aria-hidden so a
            screen reader doesn't hear every title twice). */}
        {catalogue.length > 0 && (
          <section className="section section--tint">
            <h2>A peek at the catalogue</h2>
            <p className="section-lead">Every title here has already been reviewed and approved by a moderator. This is a live sample, not a mock-up.</p>
            <div className="catalogue-scroller">
              <div className="catalogue-track" style={{ '--n': catalogue.length }}>
                {catalogue.map((c) => <CatalogueCard item={c} key={c.id} />)}
                {catalogue.map((c) => <CatalogueCard item={c} key={`dup-${c.id}`} ariaHidden />)}
              </div>
            </div>
          </section>
        )}

        {/* The actual gap this product fills, per the team's own research —
            an asymmetric "old ways vs. Pip" layout, not three equal cards
            in a row. */}
        <section className="section">
          <h2>Why not just search?</h2>
          <div className="diff-layout">
            <div className="diff-old">
              {OLD_WAYS.map((d) => (
                <div className="diff-old-item" key={d.title}>
                  <div className="diff-old-icon"><d.icon width={20} height={20} /></div>
                  <div>
                    <h3>{d.title}</h3>
                    <p>{d.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="diff-answer">
              <div className="diff-answer-icon"><PIP_ANSWER.icon width={26} height={26} /></div>
              <h3>{PIP_ANSWER.title}</h3>
              <p>{PIP_ANSWER.text}</p>
            </div>
          </div>
        </section>

        {/* CH19/CH20 — the real avatar picker, shown here as a preview
            (not interactive on this page — picking happens at first login).
            Same five characters/colours the child screen actually offers. */}
        <section className="section section--tint">
          <h2>Meet your reading buddy</h2>
          <p className="section-lead">Every child picks their own Pip on first login — five real characters, not just five paint colours.</p>
          <div className="buddy-grid">
            {Object.keys(AVATAR_COLORS).map((key) => (
              <div className="buddy-item" key={key}>
                <Avatar speaking={false} mood="happy" color={key} />
                <span>{key[0].toUpperCase() + key.slice(1)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* UV03 — subscription plans. This is the one place a solid-fill
            "featured" treatment is used on this page — everywhere else that
            device was retired in favour of outline/tint, so it keeps a
            single, unambiguous meaning: the plan that costs money. */}
        <section className="section">
          <h2>Simple plans</h2>
          <div className="plan-grid">
            <div className="plan">
              <h3>Free</h3>
              <p className="plan-price">{plans.currency} 0<span>/month</span></p>
              <ul>
                <li><CheckIcon width={16} height={16} /> Talk to Pip</li>
                <li><CheckIcon width={16} height={16} /> Age-appropriate recommendations</li>
                <li><CheckIcon width={16} height={16} /> 1 child profile</li>
                <li><CheckIcon width={16} height={16} /> Basic parent dashboard</li>
              </ul>
              <Link className="cta cta-parent" to="/parent">Get started</Link>
            </div>
            <div className="plan plan-featured">
              <div className="plan-badge">Most popular</div>
              <h3>Premium</h3>
              <p className="plan-price">{money(plans.premium_monthly_price)}<span>/month</span></p>
              <ul>
                <li><CheckIcon width={16} height={16} /> Everything in Free</li>
                <li><CheckIcon width={16} height={16} /> Up to 4 child profiles</li>
                <li><CheckIcon width={16} height={16} /> Unlimited saved favourites</li>
                <li><CheckIcon width={16} height={16} /> Full activity history &amp; insights</li>
              </ul>
              <Link className="cta cta-child" to="/parent">Choose Premium</Link>
            </div>
            {/* Ultra — the one plan with no "Most popular" badge, per
                Kiefer's explicit call: that stays a single, unambiguous
                signal on Premium alone, not something a 3rd tier dilutes. */}
            <div className="plan">
              <h3>Ultra</h3>
              <p className="plan-price">{money(plans.ultra_monthly_price)}<span>/month</span></p>
              <ul>
                <li><CheckIcon width={16} height={16} /> Everything in Premium</li>
                <li><CheckIcon width={16} height={16} /> Unlimited child profiles</li>
              </ul>
              <Link className="cta cta-parent" to="/parent">Choose Ultra</Link>
            </div>
          </div>
          <p className="plan-note">Free to start, for one child profile, for as long as you like. Prototype: payments aren't live yet; pricing is set by the admin console.</p>
        </section>

        {/* UV04 — user reviews, illustrative — see the comment on REVIEWS
            above for why this looks the way it does. */}
        <section className="section section--tint">
          <h2>What parents say</h2>
          <p className="reviews-flag"><AlertIcon width={14} height={14} /> Illustrative examples — Pip has no live families yet, so nothing below is a real quote from a real parent.</p>
          <div className="review-grid">
            {REVIEWS.map((r) => (
              <div className="review" key={r.text}>
                <QuoteIcon className="review-quote" width={24} height={24} />
                <p className="review-text">{r.text}</p>
                <p className="review-name">Example parent reaction</p>
              </div>
            ))}
          </div>
        </section>

        {/* Answers the objections a parent would actually have before
            signing up — real feature claims, not filler copy. */}
        <section className="section">
          <h2>Questions parents ask</h2>
          <div className="faq-list">
            {FAQS.map((f) => (
              <details className="faq-item" key={f.q}>
                <summary>
                  <span className="faq-summary-inner">
                    <span className="faq-icon"><f.icon width={16} height={16} /></span>
                    <span className="faq-q">{f.q}</span>
                  </span>
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* One more chance at the same single action, now that the page has
            made its case — not a new decision, a repeat of the hero's own
            primary CTA. */}
        <section className="final-cta">
          <div ref={finalAvatarRef}>
            <Avatar speaking={finalSpeaking} mood="happy" />
          </div>
          <h2>Ready when your kid is.</h2>
          <p className="section-lead">No sign-up needed to try it. Pip's ready to talk right now.</p>
          <Link className="cta cta-child" to="/child"><MicIcon width={18} height={18} /> Talk to Pip</Link>
        </section>
      </main>

      <footer className="landing-footer">
        <p className="landing-footer-meta">FYP-26-S3-18 prototype build</p>
        <p className="landing-footer-links">
          <Link to="/moderator" className="home-link">Moderator</Link> · <Link to="/admin" className="home-link">Admin</Link>
        </p>
      </footer>
    </div>
  )
}

function CatalogueCard({ item: c, ariaHidden }) {
  return (
    <div className="catalogue-card" aria-hidden={ariaHidden || undefined}>
      {c.thumbnail ? (
        <img className="catalogue-cover" src={c.thumbnail} alt="" loading="lazy" />
      ) : (
        <div className="catalogue-cover catalogue-cover-empty">
          {c.type === 'book' ? <BookIcon width={28} height={28} /> : <VideoIcon width={28} height={28} />}
        </div>
      )}
      <div className="catalogue-card-body">
        <span className="catalogue-type">{c.type === 'book' ? <BookIcon width={14} height={14} /> : <VideoIcon width={14} height={14} />} {c.type}</span>
        <h3>{curateTitle(c.title)}</h3>
      </div>
    </div>
  )
}
