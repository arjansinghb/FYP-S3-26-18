import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar, { AVATAR_COLORS } from '../components/Avatar'
import { getPublicSite, getPublicPlans, getPublicCatalogueSample, getPublicReviews, getToken, getMe } from '../api'
import { curateTitle } from '../curate'
import {
  BookIcon, ChartIcon, ChatIcon, CheckIcon, CompassIcon, HeartIcon, LockIcon, MicIcon, QuoteIcon,
  ShieldIcon, SparkleIcon, StarIcon, UsersIcon, VideoIcon,
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

// UV04 — round 3 on this section. Round 1 (specific named people, "Sarah,
// mum of two") read as real social proof no matter how small the
// disclaimer was. Round 2 (unnamed "Example parent reaction" quotes under
// a visible warning badge) was honest but read as an unfinished, still-
// testing prototype — the opposite of the "feels like a real, established
// product (Epic!, Duolingo)" impression Kiefer wants here. Neither of
// those is actually how a real product's own landing page solves this
// problem: Epic!/Duolingo don't invent individual user quotes either —
// they lead with confident, verifiable claims about the product itself.
// This section does the same: every line below is something already true
// of the real, running app (matches the FAQ/How it works sections'
// claims), just framed as a trust-badge grid instead of a bullet list —
// no invented person, no fabricated rating, nothing here that isn't
// already demonstrably real.
const TRUST_POINTS = [
  { icon: ShieldIcon, title: 'Every item is human-reviewed', text: 'Nothing reaches a recommendation until a real moderator has approved it — no exceptions.' },
  { icon: CompassIcon, title: 'Never an open search', text: "Pip only ever recommends from the curated catalogue — it can't reach into the open internet." },
  { icon: ChatIcon, title: 'Full activity visibility', text: 'Parents can see exactly what their child asked and read, any time, in the dashboard.' },
  { icon: LockIcon, title: 'Privacy by design', text: 'No ads, no behavioural profiling of children, built around parental consent from day one.' },
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
  const [reviews, setReviews] = useState([])

  // The 3 pricing-card buttons used to always say "sign up" and send
  // everyone to the same plain login/signup screen — including a parent
  // who's already logged in on this device, who'd just land back on their
  // dashboard's top instead of anywhere related to what they clicked. Only
  // used to pick each button's actual target below (see PLAN_TARGET) —
  // never gates rendering, so a stale/expired token just silently falls
  // back to the normal signup link.
  const [loggedInParent, setLoggedInParent] = useState(false)
  useEffect(() => {
    if (!getToken()) return
    getMe().then((acc) => { if (acc.role === 'parent') setLoggedInParent(true) }).catch(() => {})
  }, [])

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
    getPublicReviews(10).then(setReviews).catch(() => {})
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

  // Scroll-reveal for every section below the hero — a plain fade+slide-up
  // the first time each one crosses into view, instead of the whole page
  // sitting fully rendered and static (Kiefer's own call: the page reads
  // as more "alive"/current with this, less like a one-shot static export).
  // One shared IntersectionObserver, not the visibility-poll pattern used
  // elsewhere on this page (see the demo section's own comment) — that
  // pattern exists specifically for spots needing precise MULTI-STAGE
  // timing after the trigger; a plain one-time "has this scrolled into
  // view" check across many independent elements is exactly what
  // IntersectionObserver is for, and cheaper than polling each of them.
  // Lazily created on first ref callback (not in a useEffect) so it
  // already exists by the time React attaches every section's ref during
  // the very first commit — an effect would run one tick too late for that.
  const revealObserverRef = useRef(null)
  const reveal = (el) => {
    if (!el) return
    if (!revealObserverRef.current) {
      revealObserverRef.current = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed')
            revealObserverRef.current.unobserve(entry.target)
          }
        }
      }, { threshold: 0.15 })
    }
    revealObserverRef.current.observe(el)
  }
  useEffect(() => () => revealObserverRef.current?.disconnect(), [])

  // Nav goes from transparent-on-hero to a "glass" bar once the page has
  // actually scrolled — a static nav read as inert; this is what most
  // current SaaS/marketing sites do instead, and costs one scroll listener.
  const [navScrolled, setNavScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="landing">
      {site.announcement && <div className="announce">{site.announcement}</div>}

      <nav className={`landing-nav ${navScrolled ? 'landing-nav--scrolled' : ''}`}>
        {/* A plain <div> before this — the logo did nothing when clicked,
            unlike every other site's own brand mark (which always acts as
            a home link). Link to="/" so it also works if this component
            ever renders somewhere other than "/"; the scroll-to-top covers
            the common case of already being on the landing page, where a
            same-route Link alone wouldn't visibly do anything. */}
        <Link
          className="landing-brand"
          to="/"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <Avatar speaking={false} mood="happy" />
          <span>{site.site_title.split('—')[0].trim() || 'Pip'}</span>
        </Link>
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
        <section className="section reveal" ref={reveal}>
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
        <section className="section section--tint" ref={demoSectionRef}>
          <h2>See Pip in action</h2>
          <p className="section-lead">A real exchange with Pip — a real question, matched to a real title straight from Pip's own library.</p>
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
          <section className="section reveal" ref={reveal}>
            <h2>A peek at the catalogue</h2>
            <p className="section-lead">No stock photos, no filler — this is exactly what's waiting for your child on Pip's shelf.</p>
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
        <section className="section reveal" ref={reveal}>
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
        <section className="section reveal" ref={reveal}>
          <h2>Meet your reading buddy</h2>
          <p className="section-lead">Every child picks their own Pip on first login — five real characters, not just five paint colours.</p>
          <div className="buddy-grid">
            {Object.keys(AVATAR_COLORS).map((key) => (
              // The colour-specific class is what lets each character react
              // differently on hover (see landing.css) — a bare "buddy-item"
              // class alone can't tell blue's glasses from green's sprout.
              <div className={`buddy-item buddy-item--${key}`} key={key}>
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
        <section className="section section--tint reveal" ref={reveal}>
          <h2>Plans for every family</h2>
          <div className="plan-grid">
            {/* An already-logged-in parent clicking any of these three goes
                straight to the dashboard's Subscription card (where they'd
                actually act on a plan) instead of the plain signup/login
                screen — see the loggedInParent check above and
                ParentDashboard's matching scroll-to-hash effect. Anyone not
                logged in keeps the original behaviour untouched. */}
            <div className="plan">
              <h3>Free</h3>
              <p className="plan-price">{plans.currency} 0<span>/month</span></p>
              <ul>
                {/* Was a uniform checkmark on every line — a plain checklist
                    reads as "here's what's included," not "here's what this
                    actually gives you." One icon per feature, each matched
                    to what that line's actually about (same idea as the
                    reference pricing page Kiefer pointed at), makes each
                    line legible at a glance instead of one undifferentiated
                    block of ticks. Colour stays the single existing
                    var(--primary-500) from .plan li svg — only the glyph
                    varies, not a rainbow per icon. */}
                <li><MicIcon width={16} height={16} /> Talk to Pip</li>
                <li><ShieldIcon width={16} height={16} /> Age-appropriate recommendations</li>
                <li><UsersIcon width={16} height={16} /> 1 child profile</li>
                <li><ChartIcon width={16} height={16} /> Basic parent dashboard</li>
              </ul>
              <Link className="cta cta-parent" to={loggedInParent ? '/parent#subscription' : '/parent'}>Get Pip for free</Link>
            </div>
            <div className="plan plan-featured">
              <div className="plan-badge">Most popular</div>
              <h3>Premium</h3>
              <p className="plan-price">{money(plans.premium_monthly_price)}<span>/month</span></p>
              <ul>
                <li><StarIcon width={16} height={16} /> Everything in Free</li>
                <li><UsersIcon width={16} height={16} /> Up to 4 child profiles</li>
                <li><HeartIcon width={16} height={16} /> Unlimited saved favourites</li>
                <li><ChartIcon width={16} height={16} /> Full activity history &amp; insights</li>
              </ul>
              <Link className="cta cta-child" to={loggedInParent ? '/parent#subscription' : '/parent'}>Get Premium plan</Link>
            </div>
            {/* Ultra — the one plan with no "Most popular" badge, per
                Kiefer's explicit call: that stays a single, unambiguous
                signal on Premium alone, not something a 3rd tier dilutes. */}
            <div className="plan">
              <h3>Ultra</h3>
              <p className="plan-price">{money(plans.ultra_monthly_price)}<span>/month</span></p>
              <ul>
                <li><StarIcon width={16} height={16} /> Everything in Premium</li>
                <li><UsersIcon width={16} height={16} /> Unlimited child profiles</li>
              </ul>
              <Link className="cta cta-parent" to={loggedInParent ? '/parent#subscription' : '/parent'}>Get Ultra plan</Link>
            </div>
          </div>
          <p className="plan-note">Free to start, for one child profile, for as long as you like.</p>
        </section>

        {/* UV04 — see TRUST_POINTS above for why this is a trust-badge grid
            of real product claims, not invented user quotes. */}
        <section className="section reveal" ref={reveal}>
          <h2>Why families trust Pip</h2>
          <div className="trust-grid">
            {TRUST_POINTS.map((t) => (
              <div className="trust-point" key={t.title}>
                <div className="trust-icon"><t.icon width={20} height={20} /></div>
                <h3>{t.title}</h3>
                <p>{t.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* UV04 — the real version of the section above: an actual parent's
            own words, not a claim about the product. Only ever rendered
            once at least one review exists (an empty wall would read as
            broken, not "nothing yet") — same discipline the catalogue-
            preview section above already applies to itself. Every review
            here passed an AI safety screen AND an explicit admin approval
            before reaching this page (see backend/app/models.py's
            ReviewCreate docstring); nothing here is invented copy.

            Back to the catalogue shelf's own horizontal auto-scroll
            mechanism (Kiefer's final call) — two rows instead of one,
            each half the reviews, scrolling opposite directions. Reuses
            .catalogue-scroller's mask/overflow as-is. */}
        {reviews.length > 0 && (
          <section className="section section--tint reveal" ref={reveal}>
            <h2>What parents are saying</h2>
            <p className="section-lead">Real reviews from parents using Pip, approved by our team before they're shown here.</p>
            <div className="review-wall">
              {[
                reviews.slice(0, Math.ceil(reviews.length / 2)),
                reviews.slice(Math.ceil(reviews.length / 2)),
              ].filter((row) => row.length > 0).map((row, rowIndex) => (
                <div className="catalogue-scroller" key={rowIndex}>
                  <div
                    className={`review-track-h ${rowIndex === 1 ? 'review-track-h--reverse' : ''} ${rowIndex === 0 ? 'review-row-top' : ''}`}
                    style={{ '--n': row.length }}
                  >
                    {row.map((r, i) => <ReviewCard review={r} key={i} />)}
                    {row.map((r, i) => <ReviewCard review={r} key={`dup-${i}`} />)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Answers the objections a parent would actually have before
            signing up — real feature claims, not filler copy. */}
        <section className="section reveal" ref={reveal}>
          <h2>Questions parents ask</h2>
          <div className="faq-list">
            {FAQS.map((f) => <FaqItem key={f.q} icon={f.icon} q={f.q} a={f.a} />)}
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
        <p className="landing-footer-meta">© {new Date().getFullYear()} Pip. All rights reserved.</p>
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

function ReviewCard({ review: r }) {
  return (
    <div className="review-card">
      <div className="review-stars">
        {Array.from({ length: 5 }).map((_, i) => (
          <StarIcon key={i} width={15} height={15} filled={i < r.rating} />
        ))}
      </div>
      <QuoteIcon className="review-quote" width={22} height={22} />
      <p className="review-text">{r.text}</p>
      <p className="review-by">— {r.parent_name}</p>
    </div>
  )
}

// Native <details>/<summary> gives real keyboard/screen-reader semantics
// for free, but snaps open/closed instantly — no CSS-only way to animate
// its height across browsers. This drives that one thing manually with
// the Web Animations API instead of replacing <details> with a custom
// (less accessible) div-based accordion. `details.open` stays the DOM's
// own source of truth (read directly, not mirrored into React state) —
// letting React re-render `open` from state would fight the animation by
// flipping the attribute instantly on every render.
function FaqItem({ icon: Icon, q, a }) {
  const detailsRef = useRef(null)
  const animRef = useRef(null)
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  function onSummaryClick(e) {
    e.preventDefault()
    const details = detailsRef.current
    if (!details) return
    if (reducedMotion) { details.open = !details.open; return }

    animRef.current?.cancel()
    const summaryHeight = details.querySelector('summary').offsetHeight

    if (!details.open) {
      details.open = true
      const fullHeight = details.scrollHeight
      details.style.overflow = 'hidden'
      animRef.current = details.animate(
        { height: [`${summaryHeight}px`, `${fullHeight}px`] },
        { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      )
      animRef.current.onfinish = () => { details.style.height = ''; details.style.overflow = '' }
    } else {
      const startHeight = details.offsetHeight
      details.style.overflow = 'hidden'
      animRef.current = details.animate(
        { height: [`${startHeight}px`, `${summaryHeight}px`] },
        { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      )
      animRef.current.onfinish = () => { details.open = false; details.style.height = ''; details.style.overflow = '' }
    }
  }

  return (
    <details className="faq-item" ref={detailsRef}>
      <summary onClick={onSummaryClick}>
        <span className="faq-summary-inner">
          <span className="faq-icon"><Icon width={16} height={16} /></span>
          <span className="faq-q">{q}</span>
        </span>
      </summary>
      <p>{a}</p>
    </details>
  )
}
