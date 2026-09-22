import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { getPublicSite } from '../api'
import { MicIcon, ShieldIcon, SparkleIcon, UsersIcon } from '../icons'
import { ClusterBookGlyph, ClusterPlayGlyph, ClusterSparkleGlyph } from '../illustrations'
import './landing.css'

// trimmed-demo branch: landing page cut down to Hero + How it works only —
// the catalogue peek, "see Pip in action" demo, differentiators, avatar
// picker preview, pricing plans, trust points, review wall, and FAQ from
// the full prototype-real-integrations branch are deliberately not here.

// UV02 — how the app works. One spotlighted idea (the actual interaction
// model) plus three supporting points.
const SUPPORTING_FEATURES = [
  { icon: ShieldIcon, title: 'Always safe', text: 'Every book and video comes from a curated, pre-vetted catalogue. It never pulls from open, unfiltered sources.' },
  { icon: SparkleIcon, title: 'Personalised', text: "Matches each child's age band and interests." },
  { icon: UsersIcon, title: 'Parents in control', text: 'See activity, manage profiles, set limits.' },
]

export default function Home() {
  const [site, setSite] = useState({ site_title: 'Pip', tagline: 'Safe, age-appropriate books & videos for kids', announcement: '' })

  useEffect(() => {
    getPublicSite().then(setSite).catch(() => {})
  }, [])

  // A brief, one-time "Pip talks" moment on load — this is a voice-chat
  // product, and the hero is the one place that should actually demonstrate
  // that rather than showing a permanently silent mascot.
  const [heroSpeaking, setHeroSpeaking] = useState(false)
  useEffect(() => {
    const start = setTimeout(() => setHeroSpeaking(true), 700)
    const stop = setTimeout(() => setHeroSpeaking(false), 2600)
    return () => { clearTimeout(start); clearTimeout(stop) }
  }, [])

  // Scroll-reveal for "How it works" — a plain fade+slide-up the first
  // time it crosses into view.
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

        {/* UV02 — app information */}
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
