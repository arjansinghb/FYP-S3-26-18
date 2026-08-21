import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { getPublicSite, getPublicPlans } from '../api'
import './landing.css'

// UV02 — how the app works
const FEATURES = [
  { icon: '🎤', title: 'Just talk', text: 'Kids simply speak to Pip — no typing needed. Pip listens and talks back out loud.' },
  { icon: '🛡️', title: 'Always safe', text: 'Every book and video comes from a curated, pre-vetted catalogue — never open, unfiltered sources.' },
  { icon: '✨', title: 'Personalised', text: "Suggestions match each child's age band and interests, with a friendly reason why." },
  { icon: '👨‍👩‍👧', title: 'Parents in control', text: 'A dashboard to see activity, manage profiles, set safety limits, and flag anything.' },
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

  useEffect(() => {
    getPublicSite().then(setSite).catch(() => {})
    getPublicPlans().then(setPlans).catch(() => {})
  }, [])

  const price = `${plans.currency} ${Number(plans.monthly_price).toFixed(2)}`

  return (
    <div className="landing">
      {site.announcement && <div className="announce">{site.announcement}</div>}

      {/* UV01 — hero / landing */}
      <header className="hero">
        <Avatar speaking={false} mood="happy" />
        <h1>{site.site_title}</h1>
        <p className="hero-tag">{site.tagline}</p>
        <div className="hero-cta">
          <Link className="cta cta-child" to="/child"><span>🎤</span> I'm a child — talk to Pip</Link>
          <Link className="cta cta-parent" to="/parent"><span>👨‍👩‍👧</span> I'm a parent — sign up</Link>
        </div>
        <p className="hero-sub">Free to start · for ages 5–12</p>
      </header>

      {/* UV02 — app information */}
      <section className="section">
        <h2>How it works</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
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
              <li>Talk to Pip</li>
              <li>Age-appropriate recommendations</li>
              <li>1 child profile</li>
              <li>Basic parent dashboard</li>
            </ul>
            <Link className="cta cta-parent" to="/parent">Get started</Link>
          </div>
          <div className="plan plan-featured">
            <div className="plan-badge">Most popular</div>
            <h3>Premium</h3>
            <p className="plan-price">{price}<span>/month</span></p>
            <ul>
              <li>Everything in Free</li>
              <li>Unlimited child profiles</li>
              <li>Unlimited saved favourites</li>
              <li>Full activity history & insights</li>
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
              <div className="stars">{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</div>
              <p className="review-text">"{r.text}"</p>
              <p className="review-name">— {r.name}</p>
            </div>
          ))}
        </div>
        <p className="plan-note">Sample testimonials for the prototype.</p>
      </section>

      <footer className="landing-footer">
        FYP-26-S3-18 · prototype ·{' '}
        <Link to="/moderator" className="home-link">Moderator</Link> ·{' '}
        <Link to="/admin" className="home-link">Admin</Link>
      </footer>
    </div>
  )
}
