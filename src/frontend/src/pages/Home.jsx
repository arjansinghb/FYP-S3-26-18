import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { getPublicSite, getPublicPlans, getPublicCatalogueSample } from '../api'
import {
  BookIcon, CheckIcon, CompassIcon, MicIcon, QuoteIcon, ShieldIcon,
  SparkleIcon, StarIcon, UsersIcon, VideoIcon,
} from '../icons'
import './landing.css'

// UV02 — how the app works. First entry is the featured (large) bento tile.
const FEATURES = [
  { icon: MicIcon, title: 'Just talk', text: 'Kids simply speak to Pip — no typing needed. Pip listens and talks back out loud, like a real conversation.', large: true },
  { icon: ShieldIcon, title: 'Always safe', text: 'Every book and video comes from a curated, pre-vetted catalogue — never open, unfiltered sources.' },
  { icon: SparkleIcon, title: 'Personalised', text: "Matches each child's age band and interests." },
  { icon: UsersIcon, title: 'Parents in control', text: 'See activity, manage profiles, set limits.' },
]

// The actual gap this product fills — existing tools force a choice between
// a curated library (safe, generic) and an algorithm (personalised, opaque).
const DIFFERENTIATORS = [
  { icon: ShieldIcon, title: 'A curated library alone', bad: "Safe, but it's just a static shelf — no sense of what THIS kid wants today." },
  { icon: SparkleIcon, title: 'A search engine or open algorithm', bad: 'Personalised, but pulls from the whole internet — no one vetted what it might surface.' },
  { icon: CompassIcon, title: 'Pip', good: 'Both — recommendations only ever come from a pre-vetted catalogue, shaped by an actual conversation, not a keyword match.' },
]

const FAQS = [
  { q: 'Is it actually safe for my kid to talk to?', a: "Pip can only ever recommend books and videos from a catalogue that's been reviewed and approved by a human moderator first — never a live, open search. Your child's messages are also screened before Pip responds." },
  { q: 'What age is this for?', a: 'Ages 5–12, split into two bands (5–8 and 9–12) so the vocabulary, topics, and reading level actually match your child, not a one-size-fits-all list.' },
  { q: 'Can I see what my child has been chatting about?', a: 'Yes — the parent dashboard shows the full activity log, saved favourites, and lets you flag anything for review or adjust safety settings per child, any time.' },
  { q: 'Do I have to pay?', a: "No — the core chat experience is free forever, for one child profile. Premium adds more child profiles, unlimited favourites, and activity insights, but it never gates the chatbot itself." },
]

// UV04 — sample reviews (placeholder testimonials for the prototype)
const REVIEWS = [
  { name: 'Sarah, mum of two', stars: 5, text: 'My 6-year-old asks for "reading time" now. The peace of mind is everything.' },
  { name: 'James, dad', stars: 5, text: "Finally something fun for my kid AND I can actually see what she's doing." },
  { name: 'Priya, parent', stars: 4, text: 'The voice avatar is adorable and the book picks are genuinely age-appropriate.' },
]

export default function Home() {
  const [site, setSite] = useState({ site_title: 'Pip', tagline: 'Safe, age-appropriate books & videos for kids', announcement: '' })
  const [plans, setPlans] = useState({ currency: 'SGD', monthly_price: 9.9 })
  const [catalogue, setCatalogue] = useState([])

  useEffect(() => {
    getPublicSite().then(setSite).catch(() => {})
    getPublicPlans().then(setPlans).catch(() => {})
    getPublicCatalogueSample(10).then(setCatalogue).catch(() => {})
  }, [])

  const price = `${plans.currency} ${Number(plans.monthly_price).toFixed(2)}`

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

      {/* UV01 — hero / landing */}
      <header className="hero">
        <div className="hero-copy">
          <h1>Stories your<br />kid actually<br /><span className="hero-accent">asks for.</span></h1>
          <p className="hero-tag">{site.tagline}</p>
          <div className="hero-cta">
            <Link className="cta cta-child" to="/child"><MicIcon width={18} height={18} /> I'm a child — talk to Pip</Link>
            <Link className="cta cta-parent" to="/parent"><UsersIcon width={18} height={18} /> I'm a parent — sign up</Link>
          </div>
          <p className="hero-sub">Free to start · for ages 5–12</p>
        </div>
        {/* A loose cluster of flat pieces, not a single icon floating in a
            white card — deliberately un-gridded (see landing.css) so it
            reads as illustration, not a UI component. */}
        <div className="hero-visual">
          <div className="hero-cluster">
            <div className="cluster-piece cluster-avatar"><Avatar speaking={false} mood="happy" /></div>
            <div className="cluster-piece cluster-book"><BookIcon width={26} height={26} /></div>
            <div className="cluster-piece cluster-video"><VideoIcon width={24} height={24} /></div>
            <div className="cluster-piece cluster-star"><StarIcon width={22} height={22} /></div>
            <div className="cluster-piece cluster-sparkle"><SparkleIcon width={20} height={20} /></div>
            <p className="cluster-caption">"Want a funny book about dinosaurs?"</p>
          </div>
        </div>
      </header>

      {/* UV02 — app information */}
      <section className="section">
        <h2>How it works</h2>
        <div className="bento-grid">
          {FEATURES.map((f) => (
            <div className={`bento-tile ${f.large ? 'bento-tile-large' : ''}`} key={f.title}>
              <div className="bento-icon"><f.icon width={f.large ? 28 : 22} height={f.large ? 28 : 22} /></div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* A peek at the real catalogue — not stock photos or invented
          titles, whatever's actually moderator-approved right now
          (app/routers/public.py's catalogue-sample). Only rendered once
          real items come back, so an empty/fresh catalogue doesn't show a
          broken-looking empty grid. */}
      {catalogue.length > 0 && (
        <section className="section">
          <h2>A peek at the catalogue</h2>
          <p className="section-lead">Every title here has already been reviewed and approved by a moderator — this is a live sample, not a mock-up.</p>
          <div className="catalogue-grid">
            {catalogue.map((c) => (
              <div className="catalogue-card" key={c.id}>
                {c.thumbnail ? (
                  <img className="catalogue-cover" src={c.thumbnail} alt="" loading="lazy" />
                ) : (
                  <div className="catalogue-cover catalogue-cover-empty">
                    {c.type === 'book' ? <BookIcon width={28} height={28} /> : <VideoIcon width={28} height={28} />}
                  </div>
                )}
                <div className="catalogue-card-body">
                  <span className="catalogue-type">{c.type === 'book' ? <BookIcon width={14} height={14} /> : <VideoIcon width={14} height={14} />} {c.type}</span>
                  <h4>{c.title}</h4>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* The actual gap this product fills, per the team's own research —
          not "we're better", a specific structural comparison. */}
      <section className="section">
        <h2>Why not just search?</h2>
        <div className="diff-grid">
          {DIFFERENTIATORS.map((d) => (
            <div className={`diff-card ${d.good ? 'diff-card-good' : ''}`} key={d.title}>
              <div className="bento-icon"><d.icon width={22} height={22} /></div>
              <h3>{d.title}</h3>
              <p>{d.good || d.bad}</p>
            </div>
          ))}
        </div>
      </section>

      {/* UV03 — subscription plans */}
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
            <p className="plan-price">{price}<span>/month</span></p>
            <ul>
              <li><CheckIcon width={16} height={16} /> Everything in Free</li>
              <li><CheckIcon width={16} height={16} /> Up to 4 child profiles</li>
              <li><CheckIcon width={16} height={16} /> Unlimited saved favourites</li>
              <li><CheckIcon width={16} height={16} /> Full activity history & insights</li>
            </ul>
            <Link className="cta cta-child" to="/parent">Choose Premium</Link>
          </div>
        </div>
        <p className="plan-note">Prototype — payments aren't live yet. Pricing is set by the admin console.</p>
      </section>

      {/* UV04 — user reviews */}
      <section className="section">
        <h2>What parents say</h2>
        <div className="review-grid">
          {REVIEWS.map((r) => (
            <div className="review" key={r.name}>
              <QuoteIcon className="review-quote" width={26} height={26} />
              <div className="stars">
                {Array.from({ length: 5 }, (_, i) => (
                  <StarIcon key={i} width={16} height={16} filled={i < r.stars} />
                ))}
              </div>
              <p className="review-text">{r.text}</p>
              <p className="review-name">{r.name}</p>
            </div>
          ))}
        </div>
        <p className="plan-note">Sample testimonials for the prototype.</p>
      </section>

      {/* Answers the objections a parent would actually have before
          signing up — real feature claims, not filler copy. */}
      <section className="section">
        <h2>Questions parents ask</h2>
        <div className="faq-list">
          {FAQS.map((f) => (
            <details className="faq-item" key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* One more chance at the same single action, now that the page has
          made its case — not a new decision, a repeat of the hero's own
          primary CTA. */}
      <section className="final-cta">
        <Avatar speaking={false} mood="happy" />
        <h2>Ready when your kid is.</h2>
        <p className="section-lead">No sign-up needed to try it — Pip's ready to talk right now.</p>
        <Link className="cta cta-child" to="/child"><MicIcon width={18} height={18} /> I'm a child — talk to Pip</Link>
      </section>

      <footer className="landing-footer">
        FYP-26-S3-18 · prototype ·{' '}
        <Link to="/moderator" className="home-link">Moderator</Link> ·{' '}
        <Link to="/admin" className="home-link">Admin</Link>
      </footer>
    </div>
  )
}
