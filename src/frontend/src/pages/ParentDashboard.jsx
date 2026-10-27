import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  getToken, getMe, login, signup, logout,
  updateAccount, deleteAccount,
  listChildren, createChild, updateChild, deleteChild, updateChildSettings,
  childActivity, childFavourites, reportContent, reportChat,
  requestVerification, confirmVerification,
  requestPasswordReset, confirmPasswordReset,
  giveConsent, getPrivacySettings, updatePrivacySettings,
  requestChildDataDeletion, listChildDataDeletions, cancelChildDataDeletion,
  listNotifications, markNotificationRead, getNotificationPreferences, updateNotificationPreferences,
  getSubscriptionStatus, subscribe as subscribeApi, cancelPremium, resumePremium, getBillingHistory, updatePaymentMethod,
  getPublicPlans,
  setContentOverride, listContentOverrides, clearContentOverride, unlockChild, regenerateChildPin, regenerateChildLoginId,
  childReports, childTrends, compareChildren, createSupportTicket, mySupportTickets,
  getMyReview, submitReview,
  childArticulation, childExplanations, confirmExplanation, declineExplanation, articulationTrends,
} from '../api'
import {
  AlertIcon, BellIcon, BookIcon, ChartIcon, ChatIcon, CheckIcon, ChevronIcon, ClockIcon, CompassIcon, FlagIcon, FlameIcon, GridIcon, HeartIcon, LifeBuoyIcon, LockIcon, MicIcon,
  EditIcon, PlusIcon, SearchIcon, SettingsIcon, StarIcon, TrashIcon, UserIcon, UsersIcon, VideoIcon,
} from '../icons'
import { useToast, ToastHost } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import Sentences from '../components/Sentences'
import Select from '../components/Select'
import PasswordInput from '../components/PasswordInput'
import { firstMissingField } from '../formValidation'
import { toneStyle } from '../statTones'
import useScrolled from '../useScrolled'
import './parent.css'

// The same genre vocabulary the catalogue is actually tagged with (CM09/
// CM10) — an interest picked here is guaranteed to match real content, not
// a word that means nothing to retrieval. Order is roughly most-to-least
// common across the live catalogue, so the first row a parent sees is the
// most likely to be useful.
const INTEREST_OPTIONS = [
  'funny', 'adventure', 'science', 'animals', 'friendship', 'cosy',
  'fairytale', 'nature', 'educational', 'mystery', 'vehicles', 'space',
  'art', 'history', 'sports', 'music', 'dinosaur',
]

// Every interest picker on this page shares this one control: a row of toggle
// chips rather than a <select multiple>, whose native UI is both unstylable
// and a poor fit for "pick a few from a dozen" on a touch device.
//
// A fixed list on purpose (no free-text box). Interests drive the child's
// "For You" row and are handed to Pip as background context, and both only
// work for words the catalogue is actually tagged with. Free text would also
// put unvetted parent-typed text straight into an LLM prompt, and collects
// more personal data than the feature needs.
function InterestPicker({ value, onChange }) {
  function toggle(v) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  }

  return (
    <div className="chip-row">
      {INTEREST_OPTIONS.map((v) => (
        <button
          type="button" key={v}
          className={`chip-toggle ${value.includes(v) ? 'chip-toggle--active' : ''}`}
          aria-pressed={value.includes(v)}
          onClick={() => toggle(v)}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

// A book/video type icon in a tinted chip — same "icon-led title" pattern
// ModeratorDashboard.jsx's queue rows already use, applied here to the
// favourites list so a book/video isn't just a flat monochrome glyph
// sitting next to plain text (see .fav-icon in parent.css).
function TypeIcon({ type }) {
  const Icon = type === 'book' ? BookIcon : VideoIcon
  return <span className={`fav-icon fav-icon--${type}`}><Icon width={16} height={16} /></span>
}

// A saved item's cover (book cover or video thumbnail) when it has one, the book/video icon chip when it doesn't
// or when the image fails to load.
function FavCover({ item }) {
  const [broken, setBroken] = useState(false)
  if (!item.thumbnail || broken) return <TypeIcon type={item.type} />
  return <img className="fav-cover" src={item.thumbnail} alt="" loading="lazy" onError={() => setBroken(true)} />
}

export default function ParentDashboard() {
  const [account, setAccount] = useState(null)
  const [checking, setChecking] = useState(true)

  // Restore an existing session on load — role-checked, same as
  // Moderator/AdminDashboard. Without this, a moderator/admin token sitting
  // in the same browser (shared token storage) would render this page for
  // that account instead of falling through to the parent login form,
  // surfacing as a confusing "Not allowed for this role" error from the
  // parent-only API calls below instead of a clean sign-in screen.
  useEffect(() => {
    if (!getToken()) { setChecking(false); return }
    getMe().then((a) => { if (a.role === 'parent') setAccount(a) }).catch(() => {}).finally(() => setChecking(false))
  }, [])

  function handleDeleted() {
    logout()
    setAccount(null)
  }

  // The session disappeared under an open page (signed out in another tab, or it expired):
  // back to the sign-in screen rather than a raw "Not authenticated".
  useEffect(() => {
    const onExpired = () => setAccount(null)
    window.addEventListener('pip-session-expired', onExpired)
    return () => window.removeEventListener('pip-session-expired', onExpired)
  }, [])

  // The link in the verification email lands here. It works whether or not this
  // browser is signed in, so it's answered before the sign-in check below.
  const { pathname, state: routeState } = useLocation()
  const navigate = useNavigate()
  if (pathname.replace(/\/+$/, '') === '/parent/verify') {
    return <VerifyEmailPage onVerified={() => getMe().then((a) => { if (a.role === 'parent') setAccount(a) }).catch(() => {})} />
  }

  // "Parent sign up" on the landing page means "make a NEW account". It must not be swallowed
  // by a session that happens to be stored in this browser (it used to open that account's dashboard).
  if (routeState?.mode === 'signup') {
    return (
      <AuthPanel
        onAuthed={(acc) => { setAccount(acc); navigate('/parent', { replace: true, state: null }) }}
        signedInAs={account?.email}
        onBack={() => navigate('/parent', { replace: true, state: null })}
      />
    )
  }

  if (checking) return <div className="parent"><p className="muted">Loading…</p></div>
  if (!account) return <AuthPanel onAuthed={setAccount} />
  return (
    <Dashboard
      account={account}
      onAccountUpdated={setAccount}
      onDeleted={handleDeleted}
      onLogout={() => { logout(); setAccount(null) }}
    />
  )
}

// ---------- UV06: the page a verification link opens ----------

// One request per token for the page's whole life: in development React mounts effects
// twice, and the token is single-use, so a second request would report a good link as spent.
const verifyRequests = new Map()

function VerifyEmailPage({ onVerified }) {
  const navigate = useNavigate()
  const token = new URLSearchParams(useLocation().search).get('token') || ''
  const [state, setState] = useState(token ? 'working' : 'failed')   // working | done | failed
  const [message, setMessage] = useState(token ? '' : 'This verification link is incomplete.')

  useEffect(() => {
    if (!token) return undefined
    let live = true
    if (!verifyRequests.has(token)) verifyRequests.set(token, confirmVerification(token))
    verifyRequests.get(token)
      .then(() => { if (live) { setState('done'); onVerified?.() } })
      .catch((err) => { if (live) { setState('failed'); setMessage(err.message) } })
    return () => { live = false }
  }, [token])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="parent auth">
      <Link className="home-link" to="/">← Home</Link>
      <h1>Email verification</h1>
      <div className="card">
        {state === 'working' && <p className="muted">Verifying your email…</p>}
        {state === 'done' && (
          <>
            <p><CheckIcon width={16} height={16} /> Your email is verified. Everything is unlocked now.</p>
            <div className="row"><button onClick={() => navigate('/parent')}>Continue to dashboard</button></div>
          </>
        )}
        {state === 'failed' && (
          <>
            <p className="error">{message || 'That verification link is invalid or has expired.'}</p>
            <p className="muted">Signed in already? Use “Resend email” on your dashboard to get a new link.</p>
            <div className="row"><button className="ghost" onClick={() => navigate('/parent')}>Go to sign in</button></div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- login / sign up ----------

// Moderators and admins sign in on this same screen (it used to be two more
// forms behind footer links). Their demo accounts are listed beside the form
// so a demo can sign straight in; set VITE_HIDE_DEMO_LOGINS=true in the
// frontend env to hide the note for anything that isn't a demo.
const DEMO_STAFF_LOGINS = [
  { role: 'Moderator', email: 'moderator@pip.local', password: 'moderator123' },
  { role: 'Admin', email: 'admin@pip.local', password: 'admin123' },
]
const SHOW_DEMO_LOGINS = import.meta.env.VITE_HIDE_DEMO_LOGINS !== 'true'

function AuthPanel({ onAuthed, signedInAs, onBack }) {
  // The landing page's nav now has two separate entry points ("Log in" /
  // "Parent sign up", see Home.jsx) that each pass which form they mean
  // via router state — read that here instead of always defaulting to one
  // (this used to silently default to 'login' regardless of which link was
  // clicked, so "Parent sign up" was actually landing a brand-new parent on
  // a Sign In screen first, not the signup form its own label promised).
  const location = useLocation()
  const navigate = useNavigate()
  const [mode, setMode] = useState(location.state?.mode === 'signup' ? 'signup' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const missing = firstMissingField(mode === 'signup'
      ? [[name, 'Your name'], [email, 'Email'], [password, 'Password'], [confirmPassword, 'Confirm password']]
      : [[email, 'Email'], [password, 'Password']])
    if (missing) { setError(missing); return }
    if (mode === 'signup' && password !== confirmPassword) { setError("Passwords don't match"); return }
    setError(''); setBusy(true)
    try {
      const acc = mode === 'login'
        ? await login(email, password)
        : await signup(email, password, name)
      // One sign-in for everyone: parents stay here, staff go to their console.
      if (acc.role === 'moderator') { navigate('/moderator'); return }
      if (acc.role === 'admin') { navigate('/admin'); return }
      onAuthed(acc)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (forgot) return <ForgotPassword onBack={() => setForgot(false)} />

  // Every error this form can get back (bad/unreal address, already
  // registered, "Email is required", even login's "Wrong email or
  // password") happens to mention "email" — good enough to route it to
  // sit right under the field it's actually about instead of a single
  // generic banner at the bottom of the whole form, without needing the
  // backend to return a structured per-field shape.
  const isEmailError = /email/i.test(error || '')
  // Exact match, not a substring sniff — this string is set by this same
  // component (see submit() below), never something the backend sends.
  const isPasswordMismatch = error === "Passwords don't match"
  // Exact match against login's own distinct wrong-password message (see
  // auth.py's login()) — deliberately doesn't mention "email", so it never
  // collides with isEmailError above.
  const isWrongPassword = error === "Incorrect password"

  return (
    <div className="parent auth">
      <Link className="home-link" to="/">← Home</Link>
      <h1>{mode === 'login' ? 'Welcome back' : 'Parent Sign Up'}</h1>
      {mode === 'login' && <p className="muted auth-lead">Parents, moderators and admins all sign in here.</p>}
      {mode === 'signup' && signedInAs && (
        <p className="muted auth-lead">
          You&rsquo;re signed in as {signedInAs}. Creating a new account replaces that session.{' '}
          <button type="button" className="linkbtn" onClick={onBack}>Back to dashboard</button>
        </p>
      )}
      <form onSubmit={submit} className="card" noValidate>
        {mode === 'signup' && (
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label>Email
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className={isEmailError ? 'field-invalid' : ''}
            aria-invalid={isEmailError || undefined}
          />
        </label>
        {isEmailError && (
          <p className="field-error"><AlertIcon width={14} height={14} /> {error}</p>
        )}
        <label>Password
          <PasswordInput
            value={password} onChange={(e) => setPassword(e.target.value)} minLength={6}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className={isWrongPassword ? 'field-invalid' : ''}
            aria-invalid={isWrongPassword || undefined}
          />
        </label>
        {isWrongPassword && (
          <p className="field-error"><AlertIcon width={14} height={14} /> {error}</p>
        )}
        {mode === 'signup' && (
          <label>Confirm password
            <PasswordInput
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={6}
              autoComplete="new-password"
              className={isPasswordMismatch ? 'field-invalid' : ''}
              aria-invalid={isPasswordMismatch || undefined}
            />
          </label>
        )}
        {isPasswordMismatch && (
          <p className="field-error"><AlertIcon width={14} height={14} /> {error}</p>
        )}
        {error && !isEmailError && !isPasswordMismatch && !isWrongPassword && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Create Account'}
        </button>
      </form>
      <p className="muted">
        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <button className="linkbtn" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setConfirmPassword('') }}>
          {mode === 'login' ? 'Sign up' : 'Sign in'}
        </button>
      </p>
      {mode === 'login' && (
        <p className="muted"><button className="linkbtn" onClick={() => setForgot(true)}>Forgot password?</button></p>
      )}
      {mode === 'login' && SHOW_DEMO_LOGINS && (
        <aside className="demo-logins" aria-label="Demo moderator and admin accounts">
          <p className="demo-logins-title">Demo accounts — moderator &amp; admin</p>
          <ul>
            {DEMO_STAFF_LOGINS.map((d) => (
              <li key={d.role}>
                <span className="demo-logins-role">{d.role}</span>
                <span className="demo-logins-cred"><code>{d.email}</code> / <code>{d.password}</code></span>
                <button type="button" className="linkbtn" onClick={() => { setEmail(d.email); setPassword(d.password); setError('') }}>Use</button>
              </li>
            ))}
          </ul>
          <p className="muted">For demo purposes only.</p>
        </aside>
      )}
    </div>
  )
}

// PA03 — Reset Password
function ForgotPassword({ onBack }) {
  const [step, setStep] = useState('request') // request | confirm | done
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function request(e) {
    e.preventDefault()
    const missing = firstMissingField([[email, 'Email']])
    if (missing) { setError(missing); return }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid email address'); return }
    setError(''); setBusy(true)
    try {
      const res = await requestPasswordReset(email)
      if (res.token) { setToken(res.token); setNote(res.note) }
      setStep('confirm')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirm(e) {
    e.preventDefault()
    const missing = firstMissingField([[token, 'Reset token'], [newPassword, 'New password'], [confirmNewPassword, 'Confirm new password']])
    if (missing) { setError(missing); return }
    if (newPassword.length < 6) { setError('Password needs at least 6 characters.'); return }
    if (newPassword !== confirmNewPassword) { setError("Passwords don't match"); return }
    setError(''); setBusy(true)
    try {
      await confirmPasswordReset(token, newPassword)
      setStep('done')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="parent auth">
      <button className="linkbtn" onClick={onBack}>← Back to sign in</button>
      <h1>Reset Password</h1>
      {step === 'request' && (
        <form onSubmit={request} className="card" noValidate>
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Send reset link'}</button>
        </form>
      )}
      {step === 'confirm' && (
        <form onSubmit={confirm} className="card" noValidate>
          {note && <p className="muted"><AlertIcon width={14} height={14} /> {note}</p>}
          <label>Reset token
            <input value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          <label>New password
            <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} autoComplete="new-password" />
          </label>
          <label>Confirm new password
            <PasswordInput value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} minLength={6} autoComplete="new-password" />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Set new password'}</button>
        </form>
      )}
      {step === 'done' && (
        <div className="card">
          <p><CheckIcon width={16} height={16} /> Password updated — you can sign in with your new password now.</p>
          <button onClick={onBack}>Back to sign in</button>
        </div>
      )}
    </div>
  )
}

// ---------- dashboard ----------

// Four pages, each with its own address, switched from the bar under the
// header (per the team's wireframes):
//   Dashboard     /parent               the children at a glance, who's "in context", comparison
//   Child         /parent/child         one child's profile and tabs
//   Settings      /parent/settings      account, review, notifications, data & privacy, help
//   Subscription  /parent/subscription  plan, card, billing
const PARENT_PAGES = [
  { to: '/parent', label: 'Dashboard', end: true, icon: GridIcon },
  { to: '/parent/child', label: 'Child', icon: UsersIcon },
  { to: '/parent/settings', label: 'Settings', icon: SettingsIcon },
  { to: '/parent/subscription', label: 'Subscription', icon: StarIcon },
]

function DashCard({ id, children }) {
  return <section className="card" id={id}>{children}</section>
}

function Dashboard({ account, onAccountUpdated, onDeleted, onLogout }) {
  const { pathname, hash } = useLocation()
  const [kids, setKids] = useState([])
  // Real, reproduced bug (Kiefer, 2026-09-24): `children` starts as `[]`
  // before the first `listChildren()` round-trip ever resolves, and with
  // no loading state of its own, "No child profiles yet" rendered
  // immediately on every fresh page load — indistinguishable from a
  // genuinely empty account. On a slow connection a parent with a real
  // child already set up would see that message flash before Alex (or
  // whoever) actually showed up a moment later, which reads as "did I
  // lose my child's profile?" rather than "still loading." Only gates the
  // FIRST load — reload() after adding a child shouldn't re-show this.
  const [kidsLoading, setKidsLoading] = useState(true)
  const [error, setError] = useState('')
  // "Child in context" (PA33): which child the Child page shows — or 'all'.
  // Lives here so the Dashboard's switcher and the Child page agree.
  const [context, setContext] = useState('all')

  async function reload() {
    try { setKids(await listChildren()) } catch (err) { setError(err.message) } finally { setKidsLoading(false) }
  }
  useEffect(() => { reload() }, [])
  const scrolled = useScrolled()

  // The landing page's pricing buttons (and any old bookmark) used to point at
  // "/parent#subscription", back when Subscription was a card on one page.
  if (pathname === '/parent' && hash === '#subscription') return <Navigate to="/parent/subscription" replace />

  const premium = account.tier === 'premium'
  const page = pathname.replace(/\/+$/, '')
  let body
  if (page === '/parent') {
    body = <DashboardHome account={account} kids={kids} loading={kidsLoading} context={context} setContext={setContext} />
  } else if (page === '/parent/child') {
    body = <ChildPage account={account} onAccountUpdated={onAccountUpdated} kids={kids} loading={kidsLoading} reload={reload} context={context} setContext={setContext} />
  } else if (page === '/parent/settings') {
    body = (
      <>
        <DashCard id="account"><AccountPanel account={account} onUpdated={onAccountUpdated} onDeleted={onDeleted} /></DashCard>
        <DashCard id="review"><ReviewPanel /></DashCard>
        <DashCard id="notifications"><NotificationSettings /></DashCard>
        <DashCard id="privacy"><PrivacyPanel account={account} /></DashCard>
        <DashCard id="help"><SupportPanel /></DashCard>
      </>
    )
  } else if (page === '/parent/subscription') {
    body = <DashCard id="subscription"><SubscriptionPanel account={account} onAccountUpdated={onAccountUpdated} /></DashCard>
  } else {
    return <Navigate to="/parent" replace />
  }

  return (
    <div className="parent dash-tight parent-dash">
      <div className={`dash-top ${scrolled ? 'dash-top--scrolled' : ''}`}>
        <Link className="home-link" to="/">← Home</Link>
        <header className="parent-header">
          <div className="parent-header-who">
            <div className="parent-header-role"><UserIcon width={20} height={20} /></div>
            <div>
              <h1>Parent Dashboard</h1>
              <p className="muted parent-header-sub">
                {account.name} · {premium ? 'Premium' : 'Free'} plan
                {!kidsLoading && <> · {kids.length} of {premium ? 4 : 1} child profile{(premium ? 4 : 1) === 1 ? '' : 's'} used</>}
              </p>
            </div>
          </div>
          <div className="row">
            <NotificationsBell />
            <button className="ghost" onClick={onLogout}>Log out</button>
          </div>
        </header>

        <nav className="tabs" aria-label="Parent dashboard pages">
          {PARENT_PAGES.map(({ to, label, end, icon: Icon }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
              <Icon width={16} height={16} /> {label}
            </NavLink>
          ))}
        </nav>
      </div>

      {error && <p className="error">{error}</p>}

      {!account.verified && <VerifyBanner account={account} onAccountUpdated={onAccountUpdated} />}

      <div className="dash-stack">{body}</div>
    </div>
  )
}

// The Dashboard page: who is "in context", every child at a glance, and the
// way into the Premium comparison.
const FREE_FAVOURITES_LIMIT = 5 // PA34 — same cap the backend enforces (routers/chat.py)

function DashboardHome({ account, kids, loading, context, setContext }) {
  const navigate = useNavigate()
  function startAdd() { navigate('/parent/child', { state: { add: true } }) }
  const premium = account.tier === 'premium'
  const atLimit = !loading && kids.length >= (premium ? 4 : 1)   // Free: 1 profile, Premium: up to 4
  const [stats, setStats] = useState({})        // childId -> { messages, favourites, reports }
  const [showCompare, setShowCompare] = useState(false)

  // Counts come from the same parent-side endpoints the Child page's tabs use,
  // so the numbers here always agree with what opening those tabs shows.
  const kidsKey = kids.map((k) => k.id).join(',')
  useEffect(() => {
    let live = true
    Promise.all(kids.map(async (k) => {
      const [a, f, r] = await Promise.allSettled([childActivity(k.id), childFavourites(k.id), childReports(k.id)])
      return [k.id, {
        messages: a.status === 'fulfilled' ? a.value.length : null,
        favourites: f.status === 'fulfilled' ? f.value.length : null,
        reports: r.status === 'fulfilled' ? r.value.filter((x) => x.status === 'open').length : null,
      }]
    })).then((rows) => { if (live) setStats(Object.fromEntries(rows)) })
    return () => { live = false }
  }, [kidsKey])

  function openChild(id, tab) {
    setContext(id)
    navigate('/parent/child', tab ? { state: { tab } } : undefined)
  }
  const n = (v) => (v == null ? '—' : v)
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

  return (
    <>
      {kids.length > 1 && (
        <div className="ctx-bar">
          <span className="ctx-label">Child in context</span>
          <div className="tabs">
            <button type="button" className={context === 'all' ? 'tab active' : 'tab'} onClick={() => setContext('all')}>All children</button>
            {kids.map((k) => (
              <button type="button" key={k.id} className={context === k.id ? 'tab active' : 'tab'} onClick={() => setContext(k.id)}>{k.name}</button>
            ))}
          </div>
        </div>
      )}

      <div className="ov-head">
        <h2>Your children{loading ? '' : ` (${kids.length})`}</h2>
        {kids.length > 0 && (
          <button
            type="button" onClick={startAdd} disabled={atLimit}
            title={atLimit ? (premium ? 'You have reached the 4 child profiles Premium includes.' : 'Free includes 1 child profile. Upgrade to Premium to add more.') : undefined}
          >Add child profile</button>
        )}
      </div>

      {loading && <p className="muted">Loading your children…</p>}
      {!loading && kids.length === 0 && (
        <DashCard id="children-empty">
          <div className="ov-empty">
            <h3>No child profiles yet</h3>
            <p className="muted">Add your first child and Pip gets set up for their age, reading level and the things they love.</p>
            <button type="button" onClick={startAdd}>Add child profile</button>
            <p className="muted ov-empty-note">You will be asked for consent before any data about your child is collected.</p>
          </div>
        </DashCard>
      )}

      <div className="ov-grid">
        {kids.map((k) => {
          const st = stats[k.id] || {}
          const pending = k.pending_explanations || 0
          const favsFull = !premium && (st.favourites ?? 0) >= FREE_FAVOURITES_LIMIT
          const inContext = context === k.id
          return (
            <article key={k.id} className={`child-card ov-card${inContext ? ' ov-card--ctx' : ''}`}>
              <h3 className="ov-name">
                {k.name}
                <LevelPill level={k.articulation_level} progress={k.articulation_progress} />
              </h3>
              <p className="muted">
                {k.dob ? `${ageFromDob(k.dob)} years old` : `Age ${k.age_band}`}
                {k.gender === 'girl' ? ' · Girl' : k.gender === 'boy' ? ' · Boy' : ''}
                {k.reading_level ? ` · Reading level: ${k.reading_level}` : ''}
              </p>
              {k.interests?.length > 0 && (
                <div className="chip-row">
                  {k.interests.map((i) => <span className="chip chip-muted chip-interest" key={i}>{i}</span>)}
                </div>
              )}

              {pending > 0 ? (
                <div className="ov-banner">
                  <div>
                    <p className="ov-banner-title">{plural(pending, 'explanation')} awaiting your review</p>
                    <p className="muted">{k.name} told Pip about {plural(pending, 'saved item')}</p>
                  </div>
                  <button type="button" className="ghost" onClick={() => openChild(k.id, 'explanations')}>Review</button>
                </div>
              ) : !favsFull && (
                <div className="ov-banner ov-banner--empty">
                  <p className="ov-banner-title">Nothing awaiting your review</p>
                  <p className="muted">{k.name} can tell Pip about a saved favourite any time</p>
                </div>
              )}

              {favsFull && (
                <div className="ov-banner ov-banner--alert" role="alert">
                  <div>
                    <p className="ov-banner-title">{FREE_FAVOURITES_LIMIT} of {FREE_FAVOURITES_LIMIT} favourites saved</p>
                    <p className="muted">{k.name} has to remove one before saving anything new. Premium is unlimited.</p>
                  </div>
                  <button type="button" className="ghost" onClick={() => openChild(k.id, 'favourites')}>Manage favourites</button>
                </div>
              )}

              <div className="stat-grid">
                {[
                  { label: st.messages === 1 ? 'message' : 'messages', val: st.messages, icon: ChatIcon, tone: 'blue' },
                  { label: st.favourites === 1 ? 'favourite' : 'favourites', val: st.favourites, icon: HeartIcon, tone: 'pink' },
                  { label: st.reports === 1 ? 'open report' : 'open reports', val: st.reports, icon: FlagIcon, tone: 'orange' },
                ].map(({ label, val, icon: Icon, tone }) => (
                  <div className="stat stat--tone" style={toneStyle(tone)} key={label}>
                    <div className="stat-icon"><Icon width={18} height={18} /></div>
                    <div className="stat-num">{n(val)}</div>
                    <div className="stat-label">{label}</div>
                  </div>
                ))}
              </div>

              <div className="row">
                <button type="button" onClick={() => openChild(k.id)}>Open {k.name}&rsquo;s page</button>
                <button type="button" className="ghost" disabled={inContext} aria-pressed={inContext} onClick={() => setContext(k.id)}>
                  {inContext ? 'In context' : `Switch to ${k.name}`}
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {!premium && !loading && (
        <div className="ov-banner ov-banner--info">
          <p className="ov-banner-title">Free includes 1 child profile</p>
          <ul className="ov-perks">
            <li>Up to 4 child profiles</li>
            <li>Unlimited saved favourites</li>
            <li>Full activity history, trends and articulation history</li>
            <li>Compare children side by side</li>
          </ul>
          <div className="row">
            <button type="button" onClick={() => navigate('/parent/subscription')}>Upgrade to Premium</button>
          </div>
        </div>
      )}

      {premium && kids.length > 1 && (
        <DashCard id="compare">
          <div className="dash-panel">
            <div className="ov-compare-head">
              <h3>Compare children</h3>
              <span className="badge badge-premium">premium</span>
            </div>
            <p className="muted">
              {kids.length === 2 ? `${kids[0].name} and ${kids[1].name}` : `${kids.slice(0, -1).map((k) => k.name).join(', ')}, and ${kids[kids.length - 1].name}`} side by side: messages, recommendations, favourites and top genres.
            </p>
            <div className="row">
              <button type="button" className="ghost" aria-expanded={showCompare} onClick={() => setShowCompare((v) => !v)}>
                {showCompare ? 'Hide comparison' : 'Open comparison'}
              </button>
            </div>
            {showCompare && <CompareChildrenPanel bare />}
          </div>
        </DashCard>
      )}
    </>
  )
}

// The Child page: pick which child you're looking at (PA33), add one (PA31),
// then that child's profile and tabs.
function ChildPage({ account, onAccountUpdated, kids, loading, reload, context, setContext }) {
  const navigate = useNavigate()
  const routeState = useLocation().state || {}
  const [adding, setAdding] = useState(!!routeState.add)
  const [justAddedId, setJustAddedId] = useState(null)
  const current = kids.find((c) => c.id === context) || kids[0] || null
  const premium = account.tier === 'premium'
  const childLimit = premium ? 4 : 1
  const atLimit = !loading && kids.length >= childLimit
  // A link that asks for the add form (or a stale form) must not open past the plan's limit.
  useEffect(() => { if (atLimit) setAdding(false) }, [atLimit])

  function handleAdded(created) {
    reload()
    setAdding(false)
    if (created?.id) { setContext(created.id); setJustAddedId(created.id) }
  }

  // Verified but not consented yet: go straight to "Before you add a child…" — no "Your children — new
  // profile" heading and no child tabs / "Add Child" above it.
  if (adding && account.verified && !account.consent) {
    return <ConsentStep account={account} onAccountUpdated={onAccountUpdated} onDone={() => {}} onBack={() => setAdding(false)} />
  }

  return (
    <DashCard id="children">
      <div className="dash-panel">
        <h2 className="dash-title"><UsersIcon width={20} height={20} /> Your children{kids.length > 0 ? ` (${kids.length})` : ''}{adding ? ' — new profile' : ''}</h2>
        {loading && <p className="muted">Loading your children…</p>}
        {!loading && kids.length === 0 && !adding && (
          <p className="muted">No child profiles yet. Use “Add Child” below to create the first one.</p>
        )}
        {kids.length > 1 && !adding && (
          <p className="muted">Tap a name below to switch which child&rsquo;s profile you&rsquo;re viewing.</p>
        )}
        <div className="tabs">
          {kids.map((c) => (
            <button
              type="button" key={c.id}
              className={!adding && current?.id === c.id ? 'tab active' : 'tab'}
              onClick={() => { setAdding(false); setContext(c.id) }}
            >
              {c.name}
            </button>
          ))}
          <button
            type="button" className={adding ? 'tab active' : 'tab'} onClick={() => setAdding(true)} disabled={atLimit}
            title={atLimit ? (premium ? 'You have reached the 4 child profiles Premium includes.' : 'Free includes 1 child profile. Upgrade to Premium to add more.') : undefined}
          >
            <PlusIcon width={14} height={14} /> Add Child
          </button>
        </div>
        {kids.length >= 1 && !premium && (
          <p className="muted">
            The Free plan includes 1 child profile — Premium allows up to 4.{' '}
            <button type="button" className="linkbtn" onClick={() => navigate('/parent/subscription')}>Upgrade to Premium</button>
          </p>
        )}
        {premium && atLimit && (
          <p className="muted">You have reached the 4 child profiles Premium includes.</p>
        )}

        {adding ? (
          <AddChild account={account} onAccountUpdated={onAccountUpdated} onAdded={handleAdded} onClose={() => setAdding(false)} />
        ) : current && (
          <ChildCard
            key={current.id} child={current} account={account}
            initialView={justAddedId === current.id ? 'edit' : (routeState.tab || null)}
            onChanged={reload}
          />
        )}
      </div>
    </DashCard>
  )
}

// ---------- UV04: submit a review for the public landing page ----------
// Real gap, not a restyle: there was no way for a parent to actually leave
// one — the landing page's "Why families trust Pip" section deliberately
// used verifiable product claims instead of invented quotes (see Home.jsx's
// TRUST_POINTS comment), which is honest but isn't the same thing as a real
// parent's own words. This is that real path: written here, screened for
// safety, then only public once an admin explicitly approves it.
function ReviewPanel() {
  const [review, setReview] = useState(undefined) // undefined = loading, null = none yet
  const [rating, setRating] = useState(0) // 0 = nothing picked yet — a parent should choose, not inherit a default
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Shown briefly right after a successful submit, then the panel reverts
  // to the (blank) form on its own — a parent can always send another
  // review later, so this is a passing confirmation, not a dead end.
  const [justSubmitted, setJustSubmitted] = useState(false)

  useEffect(() => {
    getMyReview().then(setReview).catch(() => setReview(null))
  }, [])

  useEffect(() => {
    if (!justSubmitted) return
    const timer = setTimeout(() => setJustSubmitted(false), 3000)
    return () => clearTimeout(timer)
  }, [justSubmitted])

  async function submit(e) {
    e.preventDefault()
    if (!rating) { setError('Pick a star rating first.'); return }
    if (!text.trim()) { setError('Write a few words first.'); return }
    setBusy(true); setError('')
    try {
      const saved = await submitReview(rating, text.trim())
      setReview(saved)
      setText('')
      setRating(0)
      setJustSubmitted(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (review === undefined) return <div className="dash-panel"><h2 className="dash-title"><StarIcon width={20} height={20} /> Your review</h2><p className="muted">Loading…</p></div> // avoid a flash of the form before we know

  return (
    <div className="dash-panel">
      <h2 className="dash-title"><StarIcon width={20} height={20} /> Your review</h2>
      {justSubmitted ? (
        <div className="review-submitted review-submitted-thanks">
          <CheckIcon width={20} height={20} />
          <p className="review-submitted-text">Thank you for your feedback!</p>
        </div>
      ) : (
        <form className="review-form" onSubmit={submit}>
          <p className="muted">Share your experience with Pip — your feedback helps us make it better for every family.</p>
          <div className="review-field">
            <span className="review-field-label">Rating</span>
            <StarPicker value={rating} onChange={setRating} />
          </div>
          <div className="review-field">
            <label htmlFor="review-text" className="review-field-label">Your review</label>
            <textarea
              id="review-text"
              value={text} onChange={(e) => setText(e.target.value)} maxLength={600} rows={3}
              placeholder="What's it actually like using Pip with your child?"
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy} className="review-submit">{busy ? 'Submitting…' : 'Submit review'}</button>
        </form>
      )}
    </div>
  )
}

function StarPicker({ value, onChange, readOnly }) {
  return (
    <div className="star-picker" role={readOnly ? undefined : 'radiogroup'} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n} type="button" className="star-btn" disabled={readOnly}
          onClick={() => onChange?.(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          aria-pressed={n <= value}
        >
          <StarIcon width={22} height={22} filled={n <= value} />
        </button>
      ))}
    </div>
  )
}

// ---------- UV06 email verification ----------

function VerifyBanner({ account }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  // When no email can actually go out (dev mode, or the email service can't reach this address)
  // the backend hands the verification token back instead. It is shown here as the link the
  // email would have carried, so verifying stays possible without an inbox.
  const [token, setToken] = useState(account.verify_token || '')

  async function sendLink() {
    setBusy(true); setError('')
    try {
      const res = await requestVerification()
      if (res.token) setToken(res.token)
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="verify-banner" role="alert">
      <div className="verify-banner-main">
        <p className="verify-banner-title">Verify your email address</p>
        <p className="verify-banner-text">
          We sent a link to {account.email}. Some features stay locked until you confirm it.
          {token && ' Dev mode: no email service is configured, so the link is shown here instead of being emailed.'}
        </p>
        {sent && !token && <p className="verify-banner-text"><CheckIcon width={14} height={14} /> Email sent again.</p>}
        {error && <p className="error">{error}</p>}
      </div>
      <div className="verify-banner-actions">
        {token && (
          <button type="button" onClick={() => navigate(`/parent/verify?token=${encodeURIComponent(token)}`)}>Open verification link</button>
        )}
        <button type="button" className="ghost" onClick={sendLink} disabled={busy}>{busy ? 'Sending…' : 'Resend email'}</button>
      </div>
    </div>
  )
}

// ---------- PA20/22 notifications ----------

function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [loaded, setLoaded] = useState(false)

  // Fetch on mount, not just lazily when the bell is first clicked — a
  // badge that only appears after you've already opened the panel once
  // defeats the point of having one. Real found gap, not just a restyle:
  // a parent had no way to *notice* something new happened (e.g. their
  // child just activated their device) without already checking.
  useEffect(() => {
    listNotifications().then((n) => { setItems(n); setLoaded(true) }).catch(() => {})
  }, [])

  async function toggle() {
    if (!open) {
      // Refresh on every open too, so marking something read elsewhere
      // (or a new notification landing while this was closed) isn't stale.
      try { setItems(await listNotifications()); setLoaded(true) } catch { /* ignore */ }
    }
    setOpen(!open)
  }

  async function read(n) {
    if (n.read) return
    await markNotificationRead(n.id)
    setItems(items.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
  }

  const unread = items.filter((n) => !n.read).length

  return (
    <div className="notif-bell">
      <button className="notif-trigger" onClick={toggle} aria-label="Notifications" aria-expanded={open}>
        <BellIcon width={18} height={18} />
        {loaded && unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <h3>Notifications</h3>
            {loaded && unread > 0 && <span className="notif-unread-label">{unread} new</span>}
          </div>
          {items.length === 0 && <p className="muted notif-empty">Nothing yet — you'll see updates here as they happen.</p>}
          {items.map((n) => (
            <button key={n.id} className={`notif-item${n.read ? ' notif-item--read' : ''}`} onClick={() => read(n)}>
              <span className="notif-dot" />
              <span className="notif-text">
                <span className="notif-title">{n.title}</span>
                <span className="notif-body"><Sentences text={n.body} /></span>
                <span className="notif-ts">{new Date(n.created_at * 1000).toLocaleString()}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- PA22: notification preferences ----------
// The backend already had a real, working endpoint and even correctly
// respected the in_app toggle server-side (storage.py's add_notification
// checks it before ever creating a notification) — nothing here was ever
// exposed in the UI, so a parent had no way to actually turn it off.
// Honest about scope: only in_app is real right now (no email/SMS service
// or push subscription infra exists in this backend) — email/push persist
// as a preference like every real channel does, but don't deliver
// anything yet, same "flag it, don't fake it" rule the rest of this
// project follows for anything simulated.
function NotificationSettings() {
  const [prefs, setPrefs] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // PA20 — "Recent notifications" lives right under the switches (same
  // list the bell opens), so a parent sees what actually got sent.
  const [recent, setRecent] = useState(null)

  useEffect(() => { getNotificationPreferences().then(setPrefs).catch(() => {}) }, [])
  useEffect(() => { listNotifications().then(setRecent).catch(() => setRecent([])) }, [])

  async function toggle(channel) {
    if (!prefs) return
    const channels = { ...prefs.channels, [channel]: !prefs.channels[channel] }
    setPrefs({ channels }) // optimistic — a preference toggle is low-stakes to revert if the save fails
    setSaving(true); setError('')
    try {
      await updateNotificationPreferences(channels)
    } catch (err) {
      setError(err.message)
      setPrefs(prefs) // revert on a genuine failure
    } finally {
      setSaving(false)
    }
  }

  if (!prefs) return <div className="dash-panel"><h2 className="dash-title"><BellIcon width={20} height={20} /> Notifications</h2><p className="muted">Loading…</p></div>

  return (
    <div className="dash-panel">
      <h2 className="dash-title"><BellIcon width={20} height={20} /> Notifications</h2>
      <p className="muted">Get told when something needs your attention — a report gets resolved, a child activates their profile.</p>
      <label className="toggle">
        <input type="checkbox" checked={prefs.channels.in_app} onChange={() => toggle('in_app')} disabled={saving} />
        <span>In-app <span className="muted">— shows in the bell icon above</span></span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={prefs.channels.email} onChange={() => toggle('email')} disabled={saving} />
        <span>Email <span className="muted">— sent to your account email</span></span>
      </label>
      <label className="toggle toggle--off">
        <input type="checkbox" checked={false} disabled />
        <span>Push <span className="muted">— coming soon</span></span>
      </label>
      {/* Was framed as a "prototype" caveat ("aren't wired to a real
          delivery service yet") — honest to the code, but reads oddly to
          a parent, who isn't the audience for implementation status.
          Same underlying honesty (nothing here is silently overpromised),
          phrased as a normal product roadmap note instead. */}
      <p className="muted">Email goes to the address on your account. Push notifications aren&rsquo;t available yet.</p>
      {error && <p className="error">{error}</p>}
      <h4 className="dash-subhead">Recent notifications</h4>
      {recent === null && <p className="muted">Loading…</p>}
      {recent && recent.length === 0 && <p className="muted">Nothing yet — you&rsquo;ll see updates here as they happen.</p>}
      {recent && recent.length > 0 && (
        <ul className="recent-notifs">
          {recent.slice(0, 5).map((n) => {
            const kind = NOTIF_KINDS[n.type] || NOTIF_KINDS.default
            const Icon = kind.icon
            return (
              <li key={n.id} className={n.read ? 'recent-notif recent-notif--read' : 'recent-notif'}>
                <span className="recent-notif-icon" style={toneStyle(kind.tone)}><Icon width={17} height={17} /></span>
                <div className="recent-notif-main">
                  <div className="recent-notif-head">
                    <b className="recent-notif-title">{n.title}</b>
                    <span className="recent-notif-ts" title={new Date(n.created_at * 1000).toLocaleString()}>
                      {!n.read && <span className="recent-notif-dot" aria-label="Unread" />}
                      {timeAgo(n.created_at)}
                    </span>
                  </div>
                  <p className="recent-notif-body"><Sentences text={n.body} /></p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// Recent-notification rows: an icon chip per kind of event, and "2 hours ago" instead of a bare date.
const NOTIF_KINDS = {
  explanation: { icon: ChatIcon, tone: 'blue' },
  flag_resolved: { icon: FlagIcon, tone: 'success' },
  support_resolved: { icon: LifeBuoyIcon, tone: 'success' },
  child_activated: { icon: UserIcon, tone: 'pink' },
  subscription_started: { icon: StarIcon, tone: 'amber' },
  default: { icon: BellIcon, tone: 'blue' },
}

function timeAgo(ts) {
  const secs = Math.max(0, Date.now() / 1000 - ts)
  if (secs < 60) return 'Just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// ---------- account: view / edit / delete (PA04/PA05/PA06) ----------

function AccountPanel({ account, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(account.name)
  const [email, setEmail] = useState(account.email)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function save(e) {
    e.preventDefault()
    const missing = firstMissingField([[name, 'Name'], [email, 'Email']])
    if (missing) { setError(missing); return }
    if (password && password.length < 6) { setError('Password needs at least 6 characters.'); return }
    if (password !== confirmPassword) { setError("Passwords don't match"); return }
    setError(''); setBusy(true)
    const payload = { name, email }
    if (password) payload.password = password
    try {
      const updated = await updateAccount(payload)
      onUpdated({ ...account, ...updated })
      setPassword('')
      setConfirmPassword('')
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    await deleteAccount()
    onDeleted()
  }

  return (
    <>
    <div className="dash-panel">
      <h2 className="dash-title"><UserIcon width={20} height={20} /> {editing ? 'My account — editing' : 'My account'}</h2>

      {!editing ? (
        <>
          <dl className="dash-facts">
            <div><dt>Name</dt><dd>{account.name}</dd></div>
            <div>
              <dt>Email</dt>
              <dd>
                {account.email}{' '}
                <span className={`badge ${account.verified ? 'badge-approved' : 'badge-pending'}`}>
                  {account.verified ? 'verified' : 'not verified'}
                </span>
              </dd>
            </div>
            <div><dt>Plan</dt><dd>{account.tier === 'premium' ? 'Premium' : 'Free'}</dd></div>
          </dl>
          <div className="row dash-actions">
            <button className="ghost small" onClick={() => setEditing(true)}><EditIcon width={15} height={15} /> Edit details</button>
            <button className="danger small" onClick={() => setConfirmingDelete(true)}><TrashIcon width={15} height={15} /> Delete account</button>
          </div>
        </>
      ) : (
        // Was a bare <form>, no className at all — the one edit form in this
        // whole dashboard with no explicit layout of its own, so its fields
        // just fell back to plain unstyled block stacking instead of the
        // tidy flex-column-with-a-real-gap every other form here already
        // gets (see .review-form). Same treatment applied here now.
        <form className="account-edit-form" onSubmit={save} noValidate>
          <label>Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>New password
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} autoComplete="new-password" />
          </label>
          <label>Confirm new password
            <PasswordInput value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={6} autoComplete="new-password" />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className="ghost" onClick={() => { setEditing(false); setName(account.name); setEmail(account.email); setPassword(''); setConfirmPassword(''); setError('') }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
    <ConfirmDialog
      open={confirmingDelete}
      icon={<TrashIcon width={20} height={20} />}
      title="Delete your account?"
      message={<span className="dialog-line">This permanently removes your account and all linked child data. This can&rsquo;t be undone.</span>}
      confirmLabel="Delete account"
      cancelLabel="Never mind"
      onConfirm={() => { setConfirmingDelete(false); remove() }}
      onCancel={() => setConfirmingDelete(false)}
    />
    </>
  )
}

// ---------- PA23-27: subscription / billing (simulated) ----------

const TIER_INFO = {
  premium: { label: 'Premium', desc: 'Up to 4 child profiles, unlimited favourites, full activity trends, multi-child comparison.' },
}

function SubscriptionPanel({ account, onAccountUpdated }) {
  const [status, setStatus] = useState(null)
  const [plans, setPlans] = useState(null)
  const [history, setHistory] = useState([])
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [billingCycle, setBillingCycle] = useState('monthly')
  const [cardBrand, setCardBrand] = useState('Visa')
  const [cardLast4, setCardLast4] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // PA26 — the endpoint (PUT /account/payment-method) already existed and
  // worked; nothing in the UI ever called it, so a Premium parent could
  // subscribe with a card but never actually update it afterward.
  const [editingCard, setEditingCard] = useState(false)
  const [newCardBrand, setNewCardBrand] = useState('Visa')
  const [newCardLast4, setNewCardLast4] = useState('')
  const [cardBusy, setCardBusy] = useState(false)
  const [cardError, setCardError] = useState('')
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  async function reload() {
    try { setStatus(await getSubscriptionStatus()) } catch { /* ignore */ }
  }
  useEffect(() => { reload() }, [account.tier])
  useEffect(() => { getPublicPlans().then(setPlans).catch(() => {}) }, [])

  function priceFor(tier, cycle) {
    if (!plans) return null
    return plans[`${tier}_${cycle}_price`]
  }
  // Same currency the landing page's plans use ("SGD 9.90"), not a bare "$".
  const money = (v) => (v == null ? '' : `${plans?.currency || 'SGD'} ${Number(v).toFixed(2)}`)

  async function subscribe(e, tier) {
    e.preventDefault()
    if (!status?.payment_method) {
      const missing = firstMissingField([[cardBrand, 'Card brand'], [cardLast4, 'Card last 4 digits']])
      if (missing) { setError(missing); return }
      // firstMissingField only checks "typed something" — the input's own
      // minLength/maxLength can't enforce the rest since the form carries
      // noValidate. Without this, "1 digit typed" (or any wrong length)
      // sailed straight through to a real subscribe call (reported directly
      // — a card-less/underfilled purchase must never go through silently).
      if (cardLast4.length !== 4) { setError('Enter all 4 digits of the card number'); return }
    }
    setError(''); setBusy(true)
    try {
      const payment_method = status?.payment_method || (cardLast4 ? { brand: cardBrand, last4: cardLast4 } : undefined)
      const s = await subscribeApi(tier, billingCycle, payment_method)
      setStatus(s)
      onAccountUpdated({ ...account, tier })
      setShowUpgrade(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Cancelling takes effect one billing cycle from now (30 days monthly, 365 annual) — the same rule the
  // backend applies in cancel_subscription — so the date promised in the dialog is the one that gets stored.
  const fmtLong = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  const cancelDate = fmtLong(new Date(Date.now() + (status?.billing_cycle === 'annual' ? 365 : 30) * 86400000))

  async function cancel() {
    const s = await cancelPremium()
    setStatus(s)
    setConfirmingCancel(false)
  }

  async function resume() {
    const s = await resumePremium()
    setStatus(s)
  }

  async function openHistory() {
    if (!showHistory) { try { setHistory(await getBillingHistory()) } catch { /* ignore */ } }
    setShowHistory(!showHistory)
  }

  async function updateCard(e) {
    e.preventDefault()
    const missing = firstMissingField([[newCardBrand, 'Card brand'], [newCardLast4, 'Card last 4 digits']])
    if (missing) { setCardError(missing); return }
    if (newCardLast4.length !== 4) { setCardError('Enter all 4 digits of the card number'); return }
    setCardError(''); setCardBusy(true)
    try {
      const s = await updatePaymentMethod(newCardBrand, newCardLast4)
      setStatus(s)
      setEditingCard(false); setNewCardLast4('')
    } catch (err) {
      setCardError(err.message)
    } finally {
      setCardBusy(false)
    }
  }

  if (!status) return <div className="dash-panel"><h2 className="dash-title"><StarIcon width={20} height={20} /> Subscription</h2><p className="muted">Loading…</p></div>
  const price = priceFor('premium', billingCycle)
  // Same field-routing idea as AuthPanel's isWrongPassword — both card
  // errors are actually about the last-4 box, not the form in general, so
  // route them to sit right under it instead of one banner near the
  // buttons ("jgn di posisi situ" — flagged directly).
  const isCardLast4Error = error === 'Card last 4 digits is required' || error === 'Enter all 4 digits of the card number'

  // Shared by both paid tiers below — card-on-file management + cancel/
  // resume is identical either way, only the tier name/description
  // differs. A plain function returning JSX, called inline (not
  // `<PaidTierBody .../>`) — defining an actual component in here would
  // give it a fresh identity every render, so React would remount its
  // whole subtree (and drop input focus mid-keystroke in the card-update
  // form below) every time any of this panel's own state changes.
  // Sits right beside Cancel / Resume on a paid plan; on the Free plan it
  // stays next to "Upgrade to Premium" (see the row at the bottom).
  const historyBtn = (
    <button className="ghost" onClick={openHistory}>{showHistory ? 'Hide' : 'View'} billing history</button>
  )

  function paidTierBody(tier) {
    // Was just two lines of plain .muted text under the PREMIUM badge —
    // "keliatan polos banget" right after actually buying it. A tinted
    // status strip (same icon-chip language .stat-icon already uses
    // elsewhere) gives the plan/billing-cycle/price its own visual weight
    // instead of reading identically to any other caption in the app; the
    // card-on-file line becomes a real bordered row instead of an inline
    // underlined "Update" link buried in a sentence.
    const cyclePrice = status.billing_cycle ? priceFor(tier, status.billing_cycle) : null
    return (
      <>
        <div className="premium-status">
          <span className="premium-status-icon"><StarIcon width={18} height={18} /></span>
          <div>
            <p className="premium-status-title">
              {TIER_INFO[tier].label} plan
              {status.billing_cycle && cyclePrice != null && (
                <> — {status.billing_cycle === 'annual' ? 'Annual' : 'Monthly'}, {money(cyclePrice)}{status.billing_cycle === 'annual' ? '/year' : '/month'}</>
              )}
            </p>
            <p className="premium-status-sub">{TIER_INFO[tier].desc}</p>
          </div>
        </div>
        {status.payment_method && !editingCard && (
          <div className="card-on-file">
            <span>Card on file: <b>{status.payment_method.brand} •••• {status.payment_method.last4}</b></span>
            <button className="ghost small" onClick={() => { setNewCardBrand(status.payment_method.brand); setEditingCard(true) }}>Update</button>
          </div>
        )}
        {editingCard && (
          <form className="subscribe-form" onSubmit={updateCard} noValidate>
            <div className="field-row">
              <label>Card brand
                <input value={newCardBrand} onChange={(e) => setNewCardBrand(e.target.value)} />
              </label>
              <label>Card last 4 digits
                <input value={newCardLast4} onChange={(e) => setNewCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} minLength={4} maxLength={4} />
              </label>
            </div>
            <p className="muted">Simulated billing — no real charge.</p>
            {cardError && <p className="error">{cardError}</p>}
            <div className="row">
              <button type="submit" disabled={cardBusy}>{cardBusy ? 'Saving…' : 'Save card'}</button>
              <button type="button" className="ghost" onClick={() => setEditingCard(false)}>Cancel</button>
            </div>
          </form>
        )}
        {status.cancel_at
          ? (
            // Was one plain .muted line — the single most consequential
            // status this panel can show (losing Premium on a specific
            // date) read identically to any other caption ("polos banget"
            // — flagged directly). Same tinted-strip language as
            // .premium-status above, in the danger tone instead — same
            // "this is a status, colour signals its urgency" idea already
            // used across the app (badges, .stat--attention). Resume stays
            // the plain default button (tried .success/green first — asked
            // back to the app's usual purple, not a semantic green CTA).
            <>
              <div className="cancel-status">
                <span className="cancel-status-icon"><AlertIcon width={16} height={16} /></span>
                <div>
                  <p className="cancel-status-title">Cancels on {fmtLong(new Date(status.cancel_at * 1000))}</p>
                  <p className="cancel-status-sub">You'll drop to Free after that — resume anytime before then to keep Premium.</p>
                </div>
              </div>
              <div className="row sub-actions">{historyBtn}<button onClick={resume}>Resume subscription</button></div>
            </>
          )
          : (
            <div className="row sub-actions">{historyBtn}<button className="danger" onClick={() => setConfirmingCancel(true)}>Cancel subscription</button></div>
          )}
          <ConfirmDialog
            open={confirmingCancel}
            icon={<AlertIcon width={20} height={20} />}
            title={`Cancel your ${TIER_INFO[status.tier]?.label} subscription?`}
            message={<span className="dialog-line">It stays active until <b>{cancelDate}</b>, then you drop to Free. You can resume any time before then.</span>}
            confirmLabel="Cancel subscription"
            cancelLabel="Never mind"
            onConfirm={cancel}
            onCancel={() => setConfirmingCancel(false)}
          />
      </>
    )
  }

  return (
    // The landing page's pricing buttons ("Get Premium plan" etc.) send an
    // already-logged-in parent straight to this page (/parent/subscription) —
    // see Home.jsx's plan-grid Links.
    <div className="dash-panel">
      <div className="child-top child-top--inline">
        <h2 className="dash-title"><StarIcon width={20} height={20} /> {status.tier === 'free' ? (showUpgrade ? 'Subscription — upgrade' : 'Subscription') : 'Subscription — manage'}</h2>
        <span className={`badge ${status.tier === 'free' ? 'badge-pending' : 'badge-premium'}`}>{status.tier}</span>
      </div>

      {status.tier === 'free' && (
        <>
          {!showUpgrade && (
            <div className="plan-compare">
              <section className="plan-col plan-col--current">
                <span className="plan-tag">Your plan</span>
                <h3>Free</h3>
                <p className="plan-price">{plans?.currency || 'SGD'} 0<span>/month</span></p>
                <ul className="plan-perks">
                  <li>1 child profile</li>
                  <li>5 saved favourites per child</li>
                  <li>Basic activity log</li>
                </ul>
              </section>
              <section className="plan-col plan-col--premium">
                <span className="plan-tag plan-tag--premium">Recommended</span>
                <h3>Premium</h3>
                <p className="plan-price">{money(priceFor('premium', 'monthly'))}<span>/month</span></p>
                {priceFor('premium', 'annual') != null && (
                  <p className="plan-alt">or {money(priceFor('premium', 'annual'))}/year</p>
                )}
                <ul className="plan-perks">
                  <li>Up to 4 child profiles</li>
                  <li>Unlimited saved favourites</li>
                  <li>Full activity history, trends and articulation history</li>
                  <li>Compare children side by side</li>
                </ul>
                <button type="button" className="btn-grow" onClick={() => { setShowUpgrade(true); setError('') }}><StarIcon width={16} height={16} /> Upgrade to Premium</button>
              </section>
            </div>
          )}
          {showUpgrade && (
            <form className="subscribe-form" onSubmit={(e) => subscribe(e, 'premium')} noValidate>
              <p className="muted">{TIER_INFO.premium.desc}</p>
              <label>Billing cycle
                <Select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
                  <option value="monthly">Monthly — {money(priceFor('premium', 'monthly'))}</option>
                  <option value="annual">Annual — {money(priceFor('premium', 'annual'))}</option>
                </Select>
              </label>
              {status.payment_method ? (
                // A card is already on file (e.g. from a previous
                // subscription) — subscribe() below reuses it as-is, so
                // showing blank, editable brand/last-4 boxes here would be
                // pure misdirection: whatever gets typed into them is
                // silently ignored either way. Same "Card on file" wording
                // paidTierBody() already uses once Premium is active.
                <p className="muted">Card on file: {status.payment_method.brand} •••• {status.payment_method.last4}</p>
              ) : (
                <div className="field-row">
                  <label>Card brand
                    <input value={cardBrand} onChange={(e) => setCardBrand(e.target.value)} />
                  </label>
                  <label>Card last 4 digits
                    <input
                      value={cardLast4} onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} minLength={4} maxLength={4}
                      className={isCardLast4Error ? 'field-invalid' : ''}
                      aria-invalid={isCardLast4Error || undefined}
                    />
                    {/* Inside this label, not a field-row sibling — a
                        sibling stretches full width across both columns;
                        this keeps the warning scoped to just the field
                        it's actually about ("ga ush sepanjang itu"). */}
                    {isCardLast4Error && (
                      <p className="field-error"><AlertIcon width={14} height={14} /> {error}</p>
                    )}
                  </label>
                </div>
              )}
              <p className="muted">Simulated billing — no real charge.</p>
              {error && !isCardLast4Error && <p className="error">{error}</p>}
              <div className="row">
                <button type="submit" className="btn-grow" disabled={busy}>{busy ? 'Processing…' : `Confirm ${TIER_INFO.premium.label} subscription`}</button>
                <button type="button" className="ghost" onClick={() => { setShowUpgrade(false); setError('') }}>Cancel</button>
              </div>
            </form>
          )}
        </>
      )}

      {status.tier === 'premium' && paidTierBody('premium')}

      {/* "Upgrade to Premium" and "View billing history" side by side — was
          two separate stacked rows (Kiefer's own call: looks better as one
          row together). Upgrade only sits in it while free and not already
          mid-subscribe-form; billing history is always there either way.
          Also clears `error` on open — otherwise a validation warning from
          a previous attempt (e.g. "Card last 4 digits is required") stuck
          around through Cancel and reappeared on the very next open, even
          though it no longer applied to that fresh attempt ("harusnya pas
          di certain session aja" — flagged directly). Cancel below clears
          it too, for the same reason on the way out. */}
      {status.tier === 'free' && (
        <div className="row">
          {historyBtn}
        </div>
      )}
      {showHistory && (
        <div className="panel billing-panel">
          {history.length === 0 && <p className="muted">No transaction history.</p>}
          {/* Was .fav-item — borrowed straight from the favourites list,
              which reads fine for "a book" but flattened every row here
              into one plain line of text ("polos banget" — flagged
              directly). Own row now: icon chip + description/date stacked
              on the left (same idiom as .premium-status-icon above), the
              amount pulled out on its own on the right so it's scannable
              at a glance instead of buried mid-sentence. */}
          {history.map((b) => (
            <div key={b.id} className="billing-row">
              <span className="billing-row-icon"><StarIcon width={14} height={14} /></span>
              <div className="billing-row-main">
                <span className="billing-row-desc">{b.description}</span>
                <span className="billing-row-date">{new Date(b.ts * 1000).toLocaleDateString()}</span>
              </div>
              <span className="billing-row-amount">{money(b.amount_cents / 100)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- PA29: data & privacy settings ----------

// ---------- SA14: ask for help (lands in the admin's Support tab) ----------

function SupportPanel() {
  const [tickets, setTickets] = useState(null)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const load = () => mySupportTickets().then(setTickets).catch(() => setTickets([]))
  useEffect(() => { load() }, [])

  async function submit(e) {
    e.preventDefault()
    const missing = firstMissingField([[subject, 'A subject'], [message, 'A message']])
    if (missing) { setError(missing); return }
    // same limits the server enforces (3 / 10 characters), checked first so a short note gets a clear message
    if (subject.trim().length < 3) { setError('The subject needs at least 3 characters.'); return }
    if (message.trim().length < 10) { setError('Please tell us a little more — the description needs at least 10 characters.'); return }
    setError(''); setBusy(true); setSent(false)
    try {
      await createSupportTicket(subject.trim(), message.trim())
      setSubject(''); setMessage(''); setSent(true)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const day = (ts) => new Date(ts * 1000).toLocaleDateString()
  return (
    <div className="dash-panel support-card">
      <h2 className="dash-title"><LifeBuoyIcon width={20} height={20} /> Need help?</h2>
      <p className="muted">Tell us what&rsquo;s going wrong and our team will take a look. You&rsquo;ll get a notification when it&rsquo;s resolved.</p>
      <form onSubmit={submit} noValidate>
        <label>Subject
          <input value={subject} maxLength={100} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. My child can't sign in" />
        </label>
        <label>What happened?
          <textarea rows={4} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} placeholder="A few details help us fix it faster." />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
          {sent && <span className="muted"><CheckIcon width={14} height={14} /> Sent. We&rsquo;ll let you know.</span>}
        </div>
      </form>
      {tickets && tickets.length > 0 && (
        <ul className="support-list" aria-label="Your requests">
          {tickets.map((t) => (
            <li key={t.id} className="support-item">
              <span className="support-item-main">
                <b>{t.subject}</b>
                <span className="muted">Sent {day(t.ts)}{t.status === 'resolved' && t.resolved_at ? ` · Resolved ${day(t.resolved_at)}` : ''}</span>
              </span>
              <span className={`badge ${t.status === 'open' ? 'badge-pending' : 'badge-approved'}`}>{t.status === 'open' ? 'Open' : 'Resolved'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PrivacyPanel({ account }) {
  const [settings, setSettings] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!account.consent) return
    getPrivacySettings().then(setSettings).catch(() => {})
  }, [account.consent])

  async function change(value) {
    setBusy(true)
    try { setSettings(await updatePrivacySettings(value)) } finally { setBusy(false) }
  }

  if (!account.consent) {
    return (
      <div className="dash-panel">
        <h2 className="dash-title"><LockIcon width={20} height={20} /> Data &amp; Privacy</h2>
        <p className="muted">Available once you've provided parental consent (use &ldquo;Add Child&rdquo; on the Child page).</p>
      </div>
    )
  }
  if (!settings) return <div className="dash-panel"><h2 className="dash-title"><LockIcon width={20} height={20} /> Data &amp; Privacy</h2><p className="muted">Loading…</p></div>

  return (
    <div className="dash-panel">
      <h2 className="dash-title"><LockIcon width={20} height={20} /> Data &amp; Privacy</h2>
      <p className="muted">
        <span className="sentence">Your child&rsquo;s chat conversations are deleted automatically once they are older than the period below.</span>
        <span className="sentence">Favourites and learning progress are kept.</span>
      </p>
      <label>Keep chat history for
        <Select value={settings.retention_preference} disabled={busy} onChange={(e) => change(e.target.value)}>
          <option value="standard">Up to {settings.standard_days} days (standard)</option>
          <option value="minimal">{settings.minimal_days} days (minimal)</option>
        </Select>
      </label>
    </div>
  )
}

// ---------- PA28 consent (shown inline, right where it's triggered) ----------

function ConsentStep({ account, onAccountUpdated, onDone, onBack }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const missing = firstMissingField([[password, 'Password']])
    if (missing) { setError(missing); return }
    setError(''); setBusy(true)
    try {
      await giveConsent(password)
      onAccountUpdated({ ...account, consent: { timestamp: Date.now() / 1000 } })
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="card consent-card" style={{ background: 'var(--primary-100)' }} noValidate>
      <h3>Before you add a child…</h3>
      <p className="muted">
        Under PDPA, we need your verifiable consent before collecting any data about your child —
        name, age band, chat activity, and saved favourites. Re-enter your password to confirm you're
        the account holder and agree to this.
      </p>
      <label>Password
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? 'Confirming…' : 'I agree — continue'}</button>
        {onBack && <button type="button" className="ghost" onClick={onBack}>Cancel</button>}
      </div>
      <p className="muted consent-note">Consent is recorded with a timestamp against your account and can be withdrawn in Settings.</p>
    </form>
  )
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Date of birth as three of the app's own dropdowns instead of the browser's
// native date input, whose look (and pop-up calendar) can't be styled and
// read as unfinished next to everything else on the page. Emits a
// YYYY-MM-DD string once all three parts are chosen, '' otherwise.
function DobPicker({ value, onChange }) {
  // Every plausible year is listed (not just the 5-12 range), so a parent
  // with a 4- or 14-year-old can still find their year and is told why it
  // doesn't work instead of the year silently being missing.
  const maxYear = new Date().getFullYear()
  const minYear = maxYear - 20
  const split = (v) => (v ? v.split('-') : ['', '', ''])
  const [y0, m0, d0] = split(value)
  const [parts, setParts] = useState({ y: y0, m: m0, d: d0 })

  useEffect(() => {
    if (value) {
      const [y, m, d] = split(value)
      setParts({ y, m, d })
    } else if (parts.y && parts.m && parts.d) {
      setParts({ y: '', m: '', d: '' }) // the form was reset from outside
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function update(next) {
    setParts(next)
    if (next.y && next.m && next.d) {
      const daysInMonth = new Date(Number(next.y), Number(next.m), 0).getDate()
      const day = Math.min(Number(next.d), daysInMonth)
      onChange(`${next.y}-${next.m}-${String(day).padStart(2, '0')}`)
    } else {
      onChange('')
    }
  }

  const days = [<option key="d" value="">Day</option>, ...Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={String(i + 1).padStart(2, '0')}>{i + 1}</option>)]
  const months = [<option key="m" value="">Month</option>, ...MONTHS.map((name, i) => <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>)]
  const years = [<option key="y" value="">Year</option>, ...Array.from({ length: maxYear - minYear + 1 }, (_, i) => <option key={maxYear - i} value={String(maxYear - i)}>{maxYear - i}</option>)]

  const outOfRange = dobRangeProblem(value)

  return (
    <div className="dob-wrap">
    <div className="dob-picker">
      <div className="dob-part dob-part--day"><Select aria-label="Day of birth" value={parts.d} onChange={(e) => update({ ...parts, d: e.target.value })}>{days}</Select></div>
      <div className="dob-part dob-part--month"><Select aria-label="Month of birth" value={parts.m} onChange={(e) => update({ ...parts, m: e.target.value })}>{months}</Select></div>
      <div className="dob-part dob-part--year"><Select aria-label="Year of birth" value={parts.y} onChange={(e) => update({ ...parts, y: e.target.value })}>{years}</Select></div>
    </div>
    {outOfRange && (
      <div className="dob-warn" role="alert">
        <p className="dob-warn-title">{outOfRange}</p>
        <p className="dob-warn-text">Change the date, or check you picked the right year.</p>
      </div>
    )}
    </div>
  )
}

// Articulation level as a themed badge: each level has its own colour (see
// [data-level] in parent.css), and the dots show how many of the three
// confirmations toward the next level are in.
const LEVEL_ICONS = { explorer: CompassIcon, adventurer: FlameIcon, storyteller: StarIcon }
function LevelPill({ level, progress }) {
  const Icon = LEVEL_ICONS[level] || CompassIcon
  const top = level === 'storyteller'
  return (
    <span className="level-pill" data-level={level} title={top ? 'Top level reached' : `${progress} of 3 confirmations toward the next level`}>
      <Icon width={13} height={13} />
      <span>{level[0].toUpperCase() + level.slice(1)}</span>
      {!top && (
        <span className="level-pill-pips" aria-hidden="true">
          {[0, 1, 2].map((i) => <span key={i} className={i < progress ? 'level-pill-pip level-pill-pip--on' : 'level-pill-pip'} />)}
        </span>
      )}
    </span>
  )
}

// Pip is made for ages 5 to 12. null when the date is fine (or not complete yet).
function dobRangeProblem(dob) {
  if (!dob) return null
  const born = new Date(`${dob}T00:00:00`)
  if (born > new Date()) return "That date is in the future."
  const age = ageFromDob(dob)
  return age < 5 || age > 12 ? `That makes ${age === 1 ? '1 year' : `${age} years`} old. Pip is made for ages 5 to 12.` : null
}

function ageFromDob(dob) {
  const born = new Date(`${dob}T00:00:00`)
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) age--
  return age
}

// Opened by the "+ Add Child" chip in the Your children card (which owns
// whether this is showing); `onClose` hands control back, `onAdded` gets the
// freshly created profile so the dashboard can land on it.
function AddChild({ account, onAccountUpdated, onAdded, onClose }) {
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState('')
  const [interests, setInterests] = useState([])
  const [readingLevel, setReadingLevel] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const missing = firstMissingField([[name, "Child's name"], [dob, 'Date of birth']])
    if (missing) { setError(missing); return }
    if (dobRangeProblem(dob)) { setError(dobRangeProblem(dob)); return }
    setError(''); setBusy(true)
    try {
      // No pin field — the server generates a unique 6-digit linking
      // code/PIN itself (see models.ChildCreate's docstring for why letting
      // a parent type one caused real collisions between families).
      const created = await createChild({
        name, dob, reading_level: readingLevel || null,
        gender: gender || null, interests,
      })
      setName(''); setReadingLevel(''); setDob(''); setGender(''); setInterests([])
      onAdded(created)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!account.verified) {
    return <VerifyBanner account={account} onAccountUpdated={onAccountUpdated} />
  }
  if (!account.consent) {
    return <ConsentStep account={account} onAccountUpdated={onAccountUpdated} onDone={() => {}} onBack={onClose} />
  }

  return (
    <form onSubmit={submit} className="child-form" noValidate>
      <label>Child's name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field-group">
        <span className="field-group-label">Date of birth</span>
        <DobPicker value={dob} onChange={setDob} />
        <span className="field-hint">Pip is for ages 5 to 12. It picks the right books and videos from this.</span>
      </div>
      <label>Gender (optional)
        <Select value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Prefer not to say</option>
          <option value="girl">Girl</option>
          <option value="boy">Boy</option>
        </Select>
      </label>
      <label>Reading level (optional)
        <input value={readingLevel} onChange={(e) => setReadingLevel(e.target.value)} placeholder="e.g. early, middle" />
      </label>
      {/* Not just profile detail — brain.py folds these straight into what
          Pip retrieves and how it talks, so a returning child gets a
          recommendation shaped by a real signal from turn one, instead of
          Pip only learning their taste from what gets liked/saved later. */}
      <div className="field-group">
        <span className="field-group-label">What do they love? (optional)</span>
        <InterestPicker value={interests} onChange={setInterests} />
      </div>
      <p className="muted p-wide">A Login ID and PIN are generated automatically — you&rsquo;ll see them under Edit on the child&rsquo;s profile.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create profile'}</button>
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
      </div>
    </form>
  )
}

// ---------- PA32: multi-child comparison (Premium) ----------

const COMPARE_TONES = ['orange', 'blue', 'pink', 'cyan']

// PA32 — the same ingredients as one child's Insights tab (big-number tiles,
// most-asked-for bars, a 14-day chart, books vs videos), but side by side and
// with one colour per child so who-is-who reads at a glance.
function CompareChildrenPanel({ bare = false }) {
  const [rows, setRows] = useState(null)
  const [trends, setTrends] = useState({})   // childId -> ChildTrendsOut (richer breakdown; optional)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    compareChildren()
      .then(async (list) => {
        const all = await Promise.all(list.map((r) => childTrends(r.child_id).catch(() => null)))
        if (!live) return
        setTrends(Object.fromEntries(list.map((r, i) => [r.child_id, all[i]])))
        setRows(list)
      })
      .catch((err) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [])

  const heading = !bare && <h2 className="dash-title"><ChartIcon width={20} height={20} /> Compare children</h2>
  if (error) return <div className="dash-panel">{heading}<p className="error">{error}</p></div>
  if (!rows) return <div className="dash-panel">{heading}<p className="muted">Loading comparison…</p></div>

  const tones = rows.map((_, i) => COMPARE_TONES[i % COMPARE_TONES.length])
  const leaderOf = (key) => {
    const max = Math.max(...rows.map((r) => r[key]))
    const tops = rows.filter((r) => r[key] === max)
    return max > 0 && tops.length === 1 ? tops[0] : null
  }
  const topChatter = leaderOf('total_messages')
  const runnerUp = topChatter && rows.filter((r) => r !== topChatter).sort((a, b) => b.total_messages - a.total_messages)[0]
  const sharedGenres = rows[0] ? rows[0].top_genres.filter((g) => rows.every((r) => r.top_genres.includes(g))) : []

  // 14-day chart: one bar per child per day, on a shared scale
  const perDay = rows.map((r) => lastDays(trends[r.child_id]?.message_timestamps || []))
  const dayMax = Math.max(1, ...perDay.flatMap((d) => d.map((x) => x.count)))
  const hasDays = perDay.some((d) => d.some((x) => x.count > 0))
  const maxGenre = Math.max(1, ...rows.flatMap((r) => (trends[r.child_id]?.genre_counts || []).map((g) => g.count)))

  return (
    <div className="dash-panel cmp">
      {heading}

      <div className="cmp-people">
        {rows.map((r, i) => (
          <span className="cmp-person" style={toneStyle(tones[i])} key={r.child_id}>
            <span className="cmp-avatar">{r.name.slice(0, 1).toUpperCase()}</span>
            {r.name}
          </span>
        ))}
      </div>

      {topChatter && runnerUp && (
        <p className="insights-lead">
          <b>{topChatter.name}</b> is chatting the most: {topChatter.total_messages} messages, {topChatter.total_messages - runnerUp.total_messages} more than {runnerUp.name}.
        </p>
      )}

      <div className={`cmp-cols${rows.length === 4 ? ' cmp-cols--four' : ''}`}>
        {rows.map((r, i) => (
          <section className="cmp-col" style={toneStyle(tones[i])} key={r.child_id}>
            <h4 className="cmp-col-name">{r.name}</h4>
            <div className="cmp-tiles">
              <div className="cmp-tile"><span className="cmp-tile-num">{r.total_messages}</span><span className="insights-label">messages</span></div>
              <div className="cmp-tile"><span className="cmp-tile-num">{r.total_recommendations}</span><span className="insights-label">titles shown</span></div>
              <div className="cmp-tile"><span className="cmp-tile-num">{r.favourites_count}</span><span className="insights-label">saved</span></div>
            </div>
          </section>
        ))}
      </div>

      <div className={`cmp-grid2${rows.length >= 3 ? ' cmp-grid2--stack' : ''}`}>
        <section className="insights-box">
          <h4>Most asked for</h4>
          <div className="cmp-rank-cols">
            {rows.map((r, i) => {
              const genres = (trends[r.child_id]?.genre_counts || []).slice(0, 4)
              return (
                <div className="cmp-rank-col" style={toneStyle(tones[i])} key={r.child_id}>
                  <span className="cmp-genre-name">{r.name}</span>
                  {genres.length === 0 ? <span className="muted">No genres yet</span> : (
                    <ul className="rank-list">
                      {genres.map((g) => (
                        <li key={g.genre}>
                          <div className="rank-head">
                            <span className="rank-name">{g.genre}{sharedGenres.includes(g.genre) && <span className="rank-note">both enjoy</span>}</span>
                            <span className="rank-count">{g.count}</span>
                          </div>
                          <div className="rank-track cmp-track"><div className="rank-bar cmp-bar" style={{ width: `${(g.count / maxGenre) * 100}%` }} /></div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className="insights-box">
          <h4>Last {INSIGHT_DAYS} days</h4>
          {!hasDays ? <p className="muted">No chats in the last {INSIGHT_DAYS} days.</p> : (
            <div className="day-chart cmp-days" role="img" aria-label={`Messages per day over the last ${INSIGHT_DAYS} days for ${rows.map((r) => r.name).join(' and ')}`}>
              {perDay[0].map((d, di) => (
                <div className={`day-col ${d.today ? 'day-col--today' : ''}`} key={d.start}>
                  <div className="day-bar-wrap cmp-day-bars">
                    {rows.map((r, i) => {
                      const c = perDay[i][di].count
                      return <div key={r.child_id} className="day-bar cmp-day-bar" style={{ ...toneStyle(tones[i]), height: c ? `${Math.max(6, (c / dayMax) * 100)}%` : '2px' }} title={`${r.name} · ${d.full}: ${c}`} />
                    })}
                  </div>
                  <span className="day-label">{d.label}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="insights-box">
        <h4>Books vs videos</h4>
        <div className="cmp-split-rows">
          {rows.map((r, i) => {
            const t = trends[r.child_id]
            const books = t?.books_recommended || 0
            const videos = t?.videos_recommended || 0
            const kinds = books + videos
            const pct = kinds ? Math.round((books / kinds) * 100) : 0
            return (
              <div className="cmp-split" style={toneStyle(tones[i])} key={r.child_id}>
                <span className="cmp-row-name">{r.name}</span>
                <div className="split-line cmp-split-line" role="img" aria-label={`${books} books and ${videos} videos for ${r.name}`}>
                  {kinds === 0 ? <span className="cmp-split-empty" style={{ width: '100%' }} /> : <>
                    {books > 0 && <span className="cmp-split-books" style={{ width: `${pct}%` }} />}
                    {videos > 0 && <span className="cmp-split-videos" style={{ width: `${100 - pct}%` }} />}
                  </>}
                </div>
                <span className="cmp-split-text"><b>{books}</b> {books === 1 ? 'book' : 'books'} · <b>{videos}</b> {videos === 1 ? 'video' : 'videos'}</span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

// PA14 — activity used to be one undifferentiated flat feed of every
// message ever sent, oldest mixed with newest, with no sense of "this was
// one conversation." The backend already tags every entry with the real
// chat session it happened in (CH04's session_id — chat.py logs it on
// every turn); this just groups by that instead of inventing new data.
// Titled the way a chat-history sidebar titles a thread: off the first
// real thing the child said, not a fabricated summary.
function groupBySession(entries) {
  const bySession = new Map()
  for (const e of entries) {
    const key = e.session_id || 'unknown'
    if (!bySession.has(key)) bySession.set(key, [])
    bySession.get(key).push(e)
  }
  const sessions = []
  for (const [id, group] of bySession) {
    const chrono = [...group].sort((a, b) => a.ts - b.ts)
    sessions.push({
      id,
      entries: chrono,
      title: chrono[0]?.message?.slice(0, 60) || 'Conversation',
      lastTs: Math.max(...group.map((e) => e.ts)),
      count: group.length,
    })
  }
  return sessions.sort((a, b) => b.lastTs - a.lastTs)
}

// PA31 — what a parent actually wants from "trends": is my child using this,
// what do they gravitate towards, and does it match what I told Pip they like.
// Days are bucketed here (from raw timestamps) so "today" means the parent's
// own today, not the server's.
const INSIGHT_DAYS = 14

function lastDays(timestamps) {
  const days = []
  for (let i = INSIGHT_DAYS - 1; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    days.push({ start: d.getTime(), label: String(d.getDate()), full: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }), today: i === 0, count: 0 })
  }
  for (const ts of timestamps) {
    const ms = ts * 1000
    for (let i = days.length - 1; i >= 0; i--) {
      if (ms >= days[i].start) { days[i].count++; break }
    }
  }
  return days
}

// Boxes, but flat: solid fills, no gradients, no icon chips, no per-row
// rainbow. Two hues only, both from the app's own palette: purple for the
// history itself, amber for whatever deserves a second look (the top genre,
// today, what the child saved).
function InsightsPanel({ trends: t, childName }) {
  const genres = t.genre_counts || []
  const maxGenre = Math.max(1, ...genres.map((g) => g.count))
  const days = lastDays(t.message_timestamps || [])
  const maxDay = Math.max(1, ...days.map((d) => d.count))
  const kinds = t.books_recommended + t.videos_recommended
  const booksPct = kinds ? Math.round((t.books_recommended / kinds) * 100) : 0
  const interests = t.interests || []
  const enough = t.total_messages >= 3

  return (
    <div className="insights">
      {enough && (
        <p className="insights-lead">
          {genres.length > 0
            ? <>{childName} mostly asks for <b>{genres[0].genre}</b>{genres[1] && <> and <b>{genres[1].genre}</b></>}.</>
            : <>Here is how {childName} has been using Pip.</>}
        </p>
      )}

      <div className="insights-tiles">
        <div className="insights-tile"><span className="insights-num">{t.total_messages}</span><span className="insights-label">messages</span></div>
        <div className="insights-tile"><span className="insights-num">{t.total_recommendations}</span><span className="insights-label">titles shown</span></div>
        <div className="insights-tile insights-tile--warm"><span className="insights-num">{t.favourites_count}</span><span className="insights-label">saved by {childName}</span></div>
      </div>

      {!enough ? (
        <p className="muted insights-empty">Not enough activity yet to show trends. Check back after {childName} has had a few more chats with Pip.</p>
      ) : (
        <>
          <div className="insights-grid">
            <section className="insights-box">
              <h4>Most asked for</h4>
              {genres.length === 0 ? <p className="muted">No genres yet.</p> : (
                <ul className="rank-list">
                  {genres.map((g, i) => (
                    <li key={g.genre} className={i === 0 ? 'rank-top' : ''}>
                      <div className="rank-head">
                        <span className="rank-name">
                          {g.genre}
                          {interests.includes(g.genre) && <span className="rank-note">on {childName}'s list</span>}
                        </span>
                        <span className="rank-count">{g.count}</span>
                      </div>
                      <div className="rank-track"><div className="rank-bar" style={{ width: `${(g.count / maxGenre) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="insights-box">
              <h4>Last {INSIGHT_DAYS} days</h4>
              <div className="day-chart" role="img" aria-label={`Messages per day over the last ${INSIGHT_DAYS} days: ${days.map((d) => `${d.full} ${d.count}`).join(', ')}`}>
                {days.map((d, i) => (
                  <div className={`day-col ${d.today ? 'day-col--today' : ''}`} key={d.start} title={`${d.full}: ${d.count}`}>
                    <span className="day-val">{d.count || ''}</span>
                    <div className="day-bar-wrap"><div className="day-bar" style={{ height: d.count ? `${Math.max(6, (d.count / maxDay) * 100)}%` : '2px' }} /></div>
                    <span className="day-label">{d.count || d.today || i === 0 ? d.label : ''}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {kinds > 0 && (
            <section className="insights-box insights-split">
              <p>
                <b>{t.books_recommended}</b> {t.books_recommended === 1 ? 'book' : 'books'} and <b>{t.videos_recommended}</b> {t.videos_recommended === 1 ? 'video' : 'videos'} so far.
              </p>
              <div className="split-line" role="img" aria-label={`${t.books_recommended} books and ${t.videos_recommended} videos recommended`}>
                {t.books_recommended > 0 && <span className="split-books" style={{ width: `${booksPct}%` }} />}
                {t.videos_recommended > 0 && <span className="split-videos" style={{ width: `${100 - booksPct}%` }} />}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

// Free accounts: the Insights tab is there, but locked. An upgrade pitch on top, and underneath the real
// Insights layout filled with made-up sample numbers, blurred and not clickable, so a parent can see what
// Premium adds without any real data of their child's being exposed.
const INSIGHTS_PERKS = [
  (n) => `Everything ${n} has asked for, and what they gravitate towards`,
  () => 'Fourteen days of activity at a glance',
  () => 'The level journey, with the date each level was reached',
  (n) => `Every explanation you have reviewed, in ${n}\u2019s own words`,
]

function InsightsLocked({ childName }) {
  const navigate = useNavigate()
  const sample = useMemo(() => {
    const perDay = [0, 2, 1, 0, 0, 3, 4, 2, 0, 1, 5, 3, 2, 4]
    const stamps = []
    perDay.forEach((n, i) => {
      const d = new Date()
      d.setHours(12, 0, 0, 0)
      d.setDate(d.getDate() - (perDay.length - 1 - i))
      for (let k = 0; k < n; k++) stamps.push(d.getTime() / 1000 + k * 60)
    })
    return {
      child_id: 'sample', total_messages: 42, total_recommendations: 12, favourites_count: 5,
      top_genres: ['animals', 'space'], genre_counts: [{ genre: 'animals', count: 9 }, { genre: 'space', count: 6 }],
      books_recommended: 0, videos_recommended: 0, message_timestamps: stamps, interests: [],
    }
  }, [])

  return (
    <div className="insights-locked">
      <section className="locked-card">
        <span className="locked-icon"><LockIcon width={22} height={22} /></span>
        <h3>Insights are part of Premium</h3>
        <p className="muted">Premium keeps the full history and a level journey over time. {childName}&rsquo;s own experience is exactly the same on either plan.</p>
        <ul className="locked-perks">
          {INSIGHTS_PERKS.map((perk, i) => (
            <li key={i}><span className="locked-check"><CheckIcon width={12} height={12} /></span>{perk(childName)}</li>
          ))}
        </ul>
        <div className="row locked-actions">
          <button type="button" onClick={() => navigate('/parent/subscription')}>Upgrade to Premium</button>
        </div>
      </section>
      <div className="locked-preview">
        <span className="locked-preview-label">Preview</span>
        <div className="locked-preview-body" aria-hidden="true">
          <InsightsPanel trends={sample} childName={childName} />
        </div>
      </div>
    </div>
  )
}

// PA34-PA37 — articulation levels. A child explains a saved book or video to
// Pip in their own words; the parent reads what they actually said, judged
// against the level the child is at NOW (not the next one), and confirms or
// declines. Three confirmations promote the child a level. A decline is
// never shown to the child, and the item stays free to try again.
// One of the child's explanations: cover, what it was about, how it was said,
// and the child's own words as a speech bubble tinted with the colour of the
// level it was written at. `actions` is the Confirm/Decline row for a waiting
// one; a reviewed one shows its verdict instead.
function ExplanationCard({ r, childName, fmt, actions }) {
  const reviewed = r.status !== 'pending'
  return (
    <li className={`expl-item ${reviewed ? 'expl-item--reviewed' : ''}`} data-level={r.level_at}>
      {r.thumbnail
        ? <img className="expl-cover" src={r.thumbnail} alt="" />
        : <span className="expl-cover expl-cover--empty">{r.type === 'book' ? <BookIcon width={22} height={22} /> : <VideoIcon width={22} height={22} />}</span>}
      <div className="expl-item-body">
        <div className="expl-item-head">
          <div className="expl-item-titlewrap">
            <span className="expl-title">{r.title}</span>
            <span className="expl-tags">
              <span className="expl-tag">{r.type === 'book' ? <BookIcon width={12} height={12} /> : <VideoIcon width={12} height={12} />} {r.type === 'book' ? 'Book' : 'Video'}</span>
              <span className="expl-tag">{r.input_mode === 'voice' ? <><MicIcon width={12} height={12} /> Spoken</> : 'Typed'}</span>
              <span className="expl-tag expl-tag--level">{r.level_label} level</span>
            </span>
          </div>
          <span className="expl-meta">{fmt(r.created_at)}</span>
        </div>
        <p className="expl-said">{childName} said</p>
        <blockquote className="expl-quote">{r.text}</blockquote>
        {reviewed
          ? <span className={`expl-status expl-status--${r.status}`}>{r.status === 'confirmed' ? 'Confirmed' : 'Declined'}</span>
          : actions}
      </div>
    </li>
  )
}

// A reviewed explanation as a collapsible row, so a long history doesn't turn
// into a wall of cards. Closed: cover, title, type and level, a one-line
// preview of what the child said, the verdict and the date. Open: the full
// quote. Several can be open at once.
function HistoryRow({ r, childName, fmt, open, onToggle }) {
  return (
    <li className={`expl-hist ${open ? 'expl-hist--open' : ''}`} data-level={r.level_at}>
      <button type="button" className="expl-hist-head" aria-expanded={open} onClick={onToggle}>
        {r.thumbnail
          ? <img className="expl-hist-cover" src={r.thumbnail} alt="" />
          : <span className="expl-hist-cover expl-hist-cover--empty">{r.type === 'book' ? <BookIcon width={16} height={16} /> : <VideoIcon width={16} height={16} />}</span>}
        <span className="expl-hist-main">
          <span className="expl-title">{r.title}</span>
          <span className="expl-tags">
            <span className="expl-tag">{r.type === 'book' ? 'Book' : 'Video'}</span>
            <span className="expl-tag expl-tag--level">{r.level_label} level</span>
          </span>
          {!open && <span className="expl-hist-peek">&ldquo;{r.text}&rdquo;</span>}
        </span>
        <span className="expl-hist-side">
          <span className={`expl-status expl-status--${r.status}`}>{r.status === 'confirmed' ? 'Confirmed' : 'Declined'}</span>
          <span className="expl-meta">{fmt(r.created_at)}</span>
        </span>
        <ChevronIcon className="expl-hist-chev" width={18} height={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="expl-hist-body">
          <p className="expl-said">{childName} said{r.input_mode === 'voice' ? ' (spoken)' : ''}</p>
          <blockquote className="expl-quote">{r.text}</blockquote>
        </div>
      )}
    </li>
  )
}

const HISTORY_PAGE = 5

// Page numbers to show: always the first and last, and the pages around the
// current one; gaps become an ellipsis (null).
function pageList(current, total) {
  const keep = new Set([1, total, current - 1, current, current + 1])
  const out = []
  for (let n = 1; n <= total; n++) {
    if (!keep.has(n)) continue
    if (out.length && n - out[out.length - 1] > 1) out.push(null)
    out.push(n)
  }
  return out
}

// Five reviewed explanations per page, so a long history never runs far down
// the screen. A row can still be opened to read what the child said.
function ExplanationHistory({ items, childName, fmt }) {
  const [openIds, setOpenIds] = useState(() => new Set())
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(items.length / HISTORY_PAGE))
  const current = Math.min(page, pages)
  const start = (current - 1) * HISTORY_PAGE
  const toggle = (id) => setOpenIds((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  return (
    <>
      <ul className="expl-list expl-list--history">
        {items.slice(start, start + HISTORY_PAGE).map((r) => (
          <HistoryRow key={r.id} r={r} childName={childName} fmt={fmt} open={openIds.has(r.id)} onToggle={() => toggle(r.id)} />
        ))}
      </ul>
      {pages > 1 && (
        <nav className="expl-pager" aria-label="History pages">
          <span className="expl-pager-range">Showing <b>{start + 1}&ndash;{Math.min(start + HISTORY_PAGE, items.length)}</b> of <b>{items.length}</b></span>
          <div className="expl-pager-pages">
            <button type="button" className="expl-pager-btn expl-pager-step" onClick={() => setPage(current - 1)} disabled={current === 1} aria-label="Previous page">
              <ChevronIcon direction="left" width={16} height={16} /> <span className="expl-pager-label">Prev</span>
            </button>
            {pageList(current, pages).map((n, i) => (n === null
              ? <span key={`gap${i}`} className="expl-pager-gap" aria-hidden="true">…</span>
              : (
                <button
                  key={n} type="button" className={`expl-pager-btn expl-pager-num ${n === current ? 'expl-pager-btn--on' : ''}`}
                  onClick={() => setPage(n)} aria-label={`Page ${n}`} aria-current={n === current ? 'page' : undefined}
                >{n}</button>
              )))}
            <button type="button" className="expl-pager-btn expl-pager-step" onClick={() => setPage(current + 1)} disabled={current === pages} aria-label="Next page">
              <span className="expl-pager-label">Next</span> <ChevronIcon width={16} height={16} />
            </button>
          </div>
        </nav>
      )}
    </>
  )
}

const LEVEL_ORDER = ['explorer', 'adventurer', 'storyteller']

function ExplanationsPanel({ child, account, onChanged }) {
  const premium = account.tier !== 'free'
  const [level, setLevel] = useState(null)
  const [rows, setRows] = useState(null)
  const [trends, setTrends] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [leveledTo, setLeveledTo] = useState(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      const [lv, ex] = await Promise.all([childArticulation(child.id), childExplanations(child.id)])
      setLevel(lv)
      setRows(ex)
      if (premium) articulationTrends(child.id).then(setTrends).catch(() => {})
    } catch (err) {
      setError(err.message)
    }
  }
  useEffect(() => { load() }, [child.id])

  const [decliningRow, setDecliningRow] = useState(null)   // explanation waiting on the "are you sure?" step

  async function decide(row, confirm) {
    setBusyId(row.id)
    setError('')
    try {
      const res = confirm ? await confirmExplanation(row.id) : await declineExplanation(row.id)
      if (res.leveled_up) setLeveledTo(res.level.label)
      await load()
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const fmt = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const pending = (rows || []).filter((r) => r.status === 'pending')
  const reviewed = (rows || []).filter((r) => r.status !== 'pending')
  const maxWeek = Math.max(1, ...(trends?.explained_per_week || [0]))
  const article = level && /^[aeiou]/i.test(level.label) ? 'an' : 'a'

  return (
    <div className="panel panel--flat">
      <div className="expl">
        {error && <p className="error">{error}</p>}

        {leveledTo && (
          <div className="expl-banner">
            {child.name} just became {/^[aeiou]/i.test(leveledTo) ? 'an' : 'a'} <b>{leveledTo}</b>. Pip will tell them next time they chat.
          </div>
        )}

        {level && (
          <section className="expl-level" data-level={level.level}>
            <div className="expl-level-main">
              <p className="expl-kicker">Articulation level</p>
              <p className="expl-level-name">{child.name} is {article} <b>{level.label}</b></p>
              <p className="expl-descriptor">At this level, a good explanation <i>{level.descriptor.charAt(0).toLowerCase() + level.descriptor.slice(1)}</i></p>
              {level.next_level ? (
                <div className="expl-progress">
                  <span className="expl-pips" aria-hidden="true">
                    {Array.from({ length: level.needed }).map((_, i) => <span key={i} className={i < level.progress ? 'expl-pip expl-pip--on' : 'expl-pip'} />)}
                  </span>
                  <span>{level.progress} of {level.needed} confirmed to become {/^[aeiou]/i.test(level.next_label) ? 'an' : 'a'} {level.next_label}</span>
                </div>
              ) : (
                <p className="expl-progress">Top level reached. Explanations still show up here, they just no longer count toward anything.</p>
              )}
              <p className="expl-note">Separate from the reading level you set, which still decides how hard the books are.</p>
            </div>
            <ol className="expl-steps" aria-label="Levels">
              {LEVEL_ORDER.map((key, i) => {
                const cur = LEVEL_ORDER.indexOf(level.level)
                return (
                  <li key={key} data-level={key} className={`expl-step ${i < cur ? 'expl-step--done' : ''} ${i === cur ? 'expl-step--now' : ''} ${i > 0 && i <= cur ? 'expl-step--reached' : ''}`}>
                    <span className="expl-step-dot">{i < cur ? <CheckIcon width={16} height={16} /> : i + 1}</span>
                    <span className="expl-step-name">{key[0].toUpperCase() + key.slice(1)}</span>
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        <section>
          <h4 className="expl-h">Waiting for you {pending.length > 0 && <span className="expl-count">{pending.length}</span>}</h4>
          {rows === null ? <p className="muted">Loading…</p> : pending.length === 0 ? (
            <div className="expl-empty">
              <span className="expl-empty-icon"><CheckIcon width={18} height={18} /></span>
              <div>
                <b>All caught up</b>
                <span>When {child.name} tells Pip about something in their library, it shows up here.</span>
                {/* Free only ever receives the waiting ones, so "nothing yet" is only certain on Premium
                    (full history) or while a Free child is still at the very start of Explorer. */}
                {rows.length === 0 && (account.tier === 'premium' || (level && level.level === 'explorer' && level.progress === 0)) && (
                  <small>{child.name} has not explained anything yet. In their Library they tap a saved book or video and choose &ldquo;Tell Pip about this&rdquo;.</small>
                )}
              </div>
            </div>
          ) : (
            <>
              <p className="expl-note expl-note--lead">Judge each one against what {article} {level ? level.label : ''} would say. Declining isn't shown to {child.name}, and they can try that one again later.</p>
              <ul className="expl-list">
                {pending.map((r) => (
                  <ExplanationCard
                    key={r.id} r={r} childName={child.name} fmt={fmt}
                    actions={(
                      <div className="expl-actions">
                        <button onClick={() => decide(r, true)} disabled={busyId === r.id}><CheckIcon width={15} height={15} /> Confirm</button>
                        <button className="ghost" onClick={() => setDecliningRow(r)} disabled={busyId === r.id}>Decline</button>
                      </div>
                    )}
                  />
                ))}
              </ul>
            </>
          )}
        </section>

        {premium ? (
          <>
            {trends && trends.total > 0 && (
              <>
                <div className="insights-tiles expl-tiles" data-level={level?.level}>
                  <div className="insights-tile expl-tile--lv"><span className="insights-num">{trends.total}</span><span className="insights-label">explained so far</span></div>
                  <div className="insights-tile expl-tile--ok"><span className="insights-num">{trends.confirmed}</span><span className="insights-label">confirmed</span></div>
                  <div className="insights-tile insights-tile--warm"><span className="insights-num">{trends.pending}</span><span className="insights-label">waiting for you</span></div>
                </div>
                <section className="insights-grid" data-level={level?.level}>
                  <div className="insights-box">
                    <h4>Level journey</h4>
                    <ol className="expl-path">
                      {LEVEL_ORDER.map((key) => {
                        const step = trends.level_history.find((s) => s.level === key)
                        return (
                          <li key={key} data-level={key} className={step ? 'expl-path-step expl-path-step--reached' : 'expl-path-step'}>
                            <span className="expl-path-dot">{step ? <CheckIcon width={13} height={13} /> : ''}</span>
                            <div>
                              <b>{key[0].toUpperCase() + key.slice(1)}</b>
                              <span>{step ? `Reached ${fmt(step.at)}` : 'Not yet'}</span>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                  <div className="insights-box">
                    <h4>Explained, last 8 weeks</h4>
                    <div className="expl-weeks" role="img" aria-label={`Explanations per week: ${trends.explained_per_week.join(', ')}`}>
                      {trends.explained_per_week.map((n, i) => (
                        <div className="expl-week" key={i}>
                          <span className="expl-week-val">{n || ''}</span>
                          <div className="expl-week-bar" style={{ height: n ? `${Math.max(8, (n / maxWeek) * 100)}%` : '2px' }} />
                        </div>
                      ))}
                    </div>
                    <div className="expl-weeks-axis"><span>8 weeks ago</span><span>This week</span></div>
                    {trends.top_genres.length > 0 && (
                      <div className="expl-genres">
                        <span className="expl-genres-label">Most explained</span>
                        {trends.top_genres.slice(0, 4).map((g) => <span className="expl-genre" key={g.genre}>{g.genre} <b>{g.count}</b></span>)}
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}
            {reviewed.length > 0 && (
              <section>
                <h4 className="expl-h">History</h4>
                <ExplanationHistory items={reviewed} childName={child.name} fmt={fmt} />
              </section>
            )}
          </>
        ) : (
          <p className="expl-note">Premium keeps the full history and a level journey over time.</p>
        )}

        <ConfirmDialog
          open={!!decliningRow}
          icon={<AlertIcon width={20} height={20} />}
          title="Decline this explanation?"
          message={<span className="dialog-line">{decliningRow ? `“${decliningRow.title}” won’t count toward ${child.name}’s next level. Declining is never shown to ${child.name}, and they can try that item again later.` : ''}</span>}
          confirmLabel="Decline"
          cancelLabel="Go back"
          onConfirm={() => { const r = decliningRow; setDecliningRow(null); if (r) decide(r, false) }}
          onCancel={() => setDecliningRow(null)}
        />

        <section className="expl-how">
          <h4 className="expl-h">How this works</h4>
          <ul className="expl-how-list">
            <li>{child.name} picks something they have saved and tells Pip about it, by speaking or typing. Their choice.</li>
            <li>Pip always answers warmly and never marks them right or wrong.</li>
            <li>You read what they actually said and confirm it if it shows understanding at their current level.</li>
            <li>Three confirmations move them up a level. Declining is never shown to {child.name}, and they can try that item again.</li>
          </ul>
        </section>
      </div>
    </div>
  )
}

function ChildCard({ child, account, onChanged, initialView = null }) {
  const [view, setView] = useState(initialView) // 'activity' | 'favourites' | 'edit' | 'safety' | 'reports' | 'insights' | 'explanations' | 'privacy' | null
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [overrides, setOverrides] = useState({})
  const [openSessionId, setOpenSessionId] = useState(null)
  // PA14 — a search box over the session list, so a parent with a long
  // chat history finds a specific conversation directly instead of
  // scrolling the whole thing looking for it.
  const [activitySearch, setActivitySearch] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingLoginId, setConfirmingLoginId] = useState(false)
  const [confirmingPin, setConfirmingPin] = useState(false)
  // PA16 report-content — was a native prompt() for the reason plus a
  // native alert() on success; per-item id (not a bare boolean) since this
  // card can list several favourites, each with its own Report button.
  const [reportingId, setReportingId] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [confirmingReport, setConfirmingReport] = useState(null)   // the item waiting on the "are you sure?" step
  const [toast, notify] = useToast()

  async function toggle(which) {
    if (view === which) { setView(null); return }
    setView(which)
    setOpenSessionId(null)
    setActivitySearch('')
    setLoading(true)
    try {
      if (which === 'activity') setData(await childActivity(child.id))
      else if (which === 'favourites') {
        const [favs, ov] = await Promise.all([childFavourites(child.id), listContentOverrides(child.id)])
        setData(favs)
        setOverrides(Object.fromEntries(ov.map((o) => [o.content_id, o.action])))
      } else if (which === 'reports') setData(await childReports(child.id))
      else if (which === 'insights') setData(account.tier === 'premium' ? [await childTrends(child.id)] : [])   // Free sees the locked preview instead
      else setData([])
    } catch {
      setData([])
    } finally {
      setLoading(false)
    }
  }

  async function remove() {
    await deleteChild(child.id)
    onChanged()
  }

  async function submitReport(item) {
    if (!reportReason.trim()) return
    setReportBusy(true)
    try {
      setConfirmingReport(null)
      if (item.chatTs != null) await reportChat(child.id, item.chatTs, reportReason.trim())
      else await reportContent(child.id, item.id, reportReason.trim())
      notify?.(`${item.chatTs != null ? 'That chat reply' : `“${item.title}”`} reported — a member of our team will take a look.`)
      setReportingId(null)
      setReportReason('')
      if (view === 'favourites') toggle('favourites')
    } catch (err) {
      notify?.(err.message, 'danger')
    } finally {
      setReportBusy(false)
    }
  }

  async function override(item, action) {
    if (action) {
      await setContentOverride(child.id, item.id, action)
    } else {
      await clearContentOverride(child.id, item.id)
    }
    const next = { ...overrides }
    if (action) next[item.id] = action
    else delete next[item.id]
    setOverrides(next)
  }

  async function accessOptions(item) {
    if (item.external_ref) window.open(item.external_ref, '_blank', 'noopener')
    else alert('No external access link available for this title yet.')
  }

  async function unlock() {
    await unlockChild(child.id)
    onChanged()
  }

  async function regeneratePin() {
    await regenerateChildPin(child.id)
    setConfirmingPin(false)
    onChanged()
  }

  async function regenerateLoginId() {
    await regenerateChildLoginId(child.id)
    setConfirmingLoginId(false)
    onChanged()
  }

  return (
    <div className="child-detail">
      <div className="child-top">
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {child.name} <span className="child-band">{child.age_band}</span>
            {child.locked && <span className="badge badge-rejected"><LockIcon width={10} height={10} /> locked</span>}
            <LevelPill level={child.articulation_level} progress={child.articulation_progress} />
          </h3>
          <p className="muted">
            {child.dob ? `${ageFromDob(child.dob)} years old` : `Age ${child.age_band}`}
            {child.gender === 'girl' ? ' · Girl' : child.gender === 'boy' ? ' · Boy' : ''}
            {child.reading_level ? ` · Reading level: ${child.reading_level}` : ''}
          </p>
          {child.interests?.length > 0 && (
            <div className="chip-row child-interests">
              {child.interests.map((i) => <span className="chip chip-muted chip-interest" key={i}>{i}</span>)}
            </div>
          )}
        </div>
      </div>

      {child.locked && (
        <div className="card" style={{ background: 'var(--danger-100)', margin: '10px 0' }}>
          <p className="muted">Too many wrong PIN attempts — {child.name} is locked out of the chat until you unlock it.</p>
          <div className="row"><button onClick={unlock}>Unlock profile</button></div>
        </div>
      )}

      {/* Was a plain .row of buttons split arbitrarily into "solid" (small)
          and "outlined" (small ghost) — a styling accident, not a real
          selection state: Activity/Favourites/Reports/Insights always
          looked "on" and Edit/Safety/Data always looked "off" regardless
          of which one `view` actually pointed at, so opening Edit showed
          three unrelated buttons still lit up solid purple. Same .tabs/
          .tab/.tab.active pattern already used everywhere else in this app
          (Moderator/Admin/Reviews) — now the highlighted one is always
          whichever panel is actually open below, nothing else. */}
      <div className="tabs">
        <button className={view === 'activity' ? 'tab active' : 'tab'} onClick={() => toggle('activity')}>Activity</button>
        <button className={view === 'favourites' ? 'tab active' : 'tab'} onClick={() => toggle('favourites')}>Favourites</button>
        <button className={view === 'explanations' ? 'tab active' : 'tab'} onClick={() => toggle('explanations')}>
          Explanations{child.pending_explanations > 0 && <span className="tab-count">{child.pending_explanations}</span>}
        </button>
        <button className={view === 'reports' ? 'tab active' : 'tab'} onClick={() => toggle('reports')}>Reports</button>
        <button className={view === 'insights' ? 'tab active' : 'tab'} onClick={() => toggle('insights')}>
          Insights{account.tier !== 'premium' && <LockIcon width={13} height={13} aria-label="Premium" />}
        </button>
        <button className={view === 'edit' ? 'tab active' : 'tab'} onClick={() => toggle('edit')}>Edit</button>
        <button className={view === 'safety' ? 'tab active' : 'tab'} onClick={() => toggle('safety')}>Safety</button>
        <button className={view === 'privacy' ? 'tab active' : 'tab'} onClick={() => toggle('privacy')}>Data</button>
      </div>

      {view === 'edit' && (
        <div className="tab-panel">
          <div className="linking">
            <span className="muted">Give these to your child to sign in — both generated automatically:</span>
            <div className="linking-row">
              <span className="linking-label">Login ID</span>
              <code className="code">{child.login_id}</code>
              <button className="ghost small" onClick={() => setConfirmingLoginId(true)}>Generate new</button>
            </div>
            <div className="linking-row">
              <span className="linking-label">PIN</span>
              <code className="code">{child.pin}</code>
              <button className="ghost small" onClick={() => setConfirmingPin(true)}>Generate new</button>
            </div>
          </div>
          <EditChild child={child} onDone={() => { setView(null); onChanged() }} />
          {/* PA09 — wireframe "Delete Child Profile": the delete lives with
              the rest of the profile's settings under Edit, and confirms
              in place rather than from a button on the card's header. */}
          <div className="child-danger">
            <button className="danger small" onClick={() => setConfirmingDelete(true)}><TrashIcon width={15} height={15} /> Delete profile</button>
          </div>
        </div>
      )}
      {view === 'safety' && <SafetySettings child={child} onDone={() => { setView(null); onChanged() }} />}
      {view === 'privacy' && <ChildDataPrivacy child={child} />}
      {view === 'explanations' && <ExplanationsPanel child={child} account={account} onChanged={onChanged} />}
      {view === 'insights' && account.tier !== 'premium' && <InsightsLocked childName={child.name} />}

      {(view === 'activity' || view === 'favourites' || view === 'reports' || (view === 'insights' && account.tier === 'premium')) && (
        <div className="panel">
          {loading && <p className="muted">Loading…</p>}
          {!loading && data.length === 0 && <p className="muted">Nothing here yet.</p>}

          {/* PA14 — a real session list (like a chat-history sidebar: pick
              a past conversation, see what was actually said in it), not
              one long undifferentiated feed. */}
          {!loading && view === 'activity' && (() => {
            const allSessions = groupBySession(data)
            const query = activitySearch.trim().toLowerCase()
            const sessions = !query ? allSessions : allSessions.filter((s) =>
              s.title.toLowerCase().includes(query) ||
              s.entries.some((e) => e.message?.toLowerCase().includes(query) || e.reply?.toLowerCase().includes(query))
            )
            const open = sessions.find((s) => s.id === openSessionId) || null
            return (
              <div className="session-browser">
                {allSessions.length > 3 && (
                  <div className="session-search">
                    <SearchIcon width={15} height={15} />
                    <input
                      type="search"
                      value={activitySearch}
                      onChange={(e) => setActivitySearch(e.target.value)}
                      placeholder="Search this child's chat history…"
                    />
                  </div>
                )}
                {query && (
                  <p className="muted session-search-count">
                    {sessions.length} of {allSessions.length} conversation{allSessions.length === 1 ? '' : 's'} match{sessions.length === 1 ? 'es' : ''}
                  </p>
                )}
                {query && sessions.length === 0 && (
                  <p className="muted">No conversations match “{activitySearch}”.</p>
                )}
                {/* Side by side (list | transcript) on a wide screen — a real
                    chat-history layout, like the session-title comment above
                    always intended — instead of stacking the opened
                    transcript directly underneath the list inside the same
                    cramped scroll box. Collapses to stacked on narrow
                    viewports (see the media query next to .session-body). */}
                <div className="session-body">
                  <div className="session-list">
                    {sessions.map((s) => (
                      <button
                        key={s.id}
                        className={`session-row ${s.id === openSessionId ? 'session-row--active' : ''}`}
                        onClick={() => setOpenSessionId(s.id === openSessionId ? null : s.id)}
                      >
                        <ChatIcon width={14} height={14} />
                        <span className="session-row-body">
                          <span className="session-row-title">{s.title}</span>
                          <span className="session-row-meta">
                            <ClockIcon width={11} height={11} /> {new Date(s.lastTs * 1000).toLocaleString()} · {s.count} {s.count === 1 ? 'message' : 'messages'}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {open ? (
                    <div className="session-transcript">
                      {open.entries.map((a, i) => (
                        <div key={i} className="activity-entry">
                          <div className="activity-line activity-line--child">
                            <span className="activity-avatar activity-avatar--child"><UserIcon width={13} height={13} /></span>
                            <span className="activity-bubble activity-bubble--child">{a.message}</span>
                          </div>
                          <div className="activity-line activity-line--pip">
                            <span className="activity-avatar activity-avatar--pip"><ChatIcon width={13} height={13} /></span>
                            <span className="activity-bubble activity-bubble--pip">{a.reply}</span>
                          </div>
                          <p className="ts">{new Date(a.ts * 1000).toLocaleString()}</p>
                          {reportingId === `chat-${a.ts}` ? (
                            <form
                              className="row inline-confirm report-inline-form"
                              onSubmit={(e) => { e.preventDefault(); if (reportReason.trim()) setConfirmingReport({ chatTs: a.ts }) }}
                            >
                              <input
                                autoFocus
                                value={reportReason}
                                onChange={(e) => setReportReason(e.target.value)}
                                placeholder="What was wrong with this reply?"
                                aria-label="Reason for reporting this chat reply"
                              />
                              <button type="submit" className="danger small" disabled={reportBusy || !reportReason.trim()}>
                                {reportBusy ? 'Reporting…' : 'Submit report'}
                              </button>
                              <button type="button" className="ghost small" onClick={() => { setReportingId(null); setReportReason('') }}>Cancel</button>
                            </form>
                          ) : (
                            <button className="ghost small" onClick={() => { setReportingId(`chat-${a.ts}`); setReportReason('') }}>
                              <FlagIcon width={14} height={14} /> Report
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : sessions.length > 0 && (
                    <div className="session-transcript session-transcript--empty">
                      <ChatIcon width={28} height={28} />
                      <p className="muted p-wide">Pick a conversation on the left to see what was actually said.</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {!loading && view === 'favourites' && data.length > 0 && (
            <p className="muted fav-summary">
              {account.tier === 'premium'
                ? `Premium plan · unlimited favourites saved (${data.length} total)`
                : `Free plan · ${data.length} of 5 favourites saved`}
            </p>
          )}

          {!loading && view === 'favourites' && data.map((f) => (
            <div key={f.id} className={`fav-item ${reportingId === f.id ? 'fav-item--reporting' : ''}${reportingId !== f.id ? ' fav-item--noted' : ''}`}>
              <span className="fav-info">
                <FavCover item={f} />
                <span className="fav-text">
                  <span className="fav-title fav-title--wrap">{f.title}</span>
                  <span className="fav-type-row">
                    <span className="fav-type">{f.type === 'book' ? 'Book' : 'Video'}</span>
                    {overrides[f.id] === 'approve' && <span className="badge badge-approved">Approved</span>}
                    {overrides[f.id] === 'hide' && <span className="badge badge-rejected">Blocked</span>}
                  </span>
                </span>
              </span>
              {reportingId === f.id ? (
                // .fav-item is a single flex ROW (title | buttons) — the
                // report form used to sit in that same cramped slot next
                // to the title, squeezing its input down to almost nothing.
                // .fav-item--reporting drops the whole row to a column so
                // this gets its own full-width line underneath instead.
                <form
                  className="row inline-confirm report-inline-form"
                  onSubmit={(e) => { e.preventDefault(); if (reportReason.trim()) setConfirmingReport(f) }}
                >
                  <input
                    autoFocus
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    placeholder={`Why are you reporting "${f.title}"?`}
                    aria-label={`Reason for reporting ${f.title}`}
                  />
                  <button type="submit" className="danger small" disabled={reportBusy || !reportReason.trim()}>
                    {reportBusy ? 'Reporting…' : 'Submit report'}
                  </button>
                  <button type="button" className="ghost small" onClick={() => { setReportingId(null); setReportReason('') }}>Cancel</button>
                </form>
              ) : (
                <div className="row">
                  {(f.type === 'book' || f.external_ref) && <button className="ghost small" onClick={() => accessOptions(f)}>Access Options</button>}
                  <button
                    className={`ghost small ${overrides[f.id] === 'approve' ? 'on' : ''}`}
                    onClick={() => override(f, overrides[f.id] === 'approve' ? undefined : 'approve')}
                    title="Always allow this item for this child, even outside their age band"
                  ><CheckIcon width={14} height={14} /> Approve</button>
                  <button
                    className={`ghost small ${overrides[f.id] === 'hide' ? 'on' : ''}`}
                    onClick={() => override(f, overrides[f.id] === 'hide' ? undefined : 'hide')}
                    title="Never recommend this item to this child"
                  ><LockIcon width={14} height={14} /> Block</button>
                  <button className="ghost small" onClick={() => { setReportingId(f.id); setReportReason('') }}><FlagIcon width={14} height={14} /> Report</button>
                </div>
              )}
              {reportingId !== f.id && (
                <p className="fav-note">
                  <span className="sentence">
                    {overrides[f.id] === 'approve'
                      ? <>Always allowed for {child.name}.</>
                      : overrides[f.id] === 'hide'
                        ? <>Pip will not suggest this to {child.name} again. It stays in their library until they remove it.</>
                        : <>Pip may suggest this to {child.name} when it fits their age.</>}
                  </span>
                  {(f.type === 'book' || f.external_ref) && overrides[f.id] !== 'hide' && (
                    <span className="sentence">Access Options opens the library or publisher page in your browser, not in {child.name}&rsquo;s app.</span>
                  )}
                </p>
              )}
            </div>
          ))}

          {/* PA17 — was a single bare line of "title — reason" plus a
              status badge, no icon, no date. Same fav-item/fav-info/
              fav-text shell the Favourites list already uses (icon chip +
              title + subtitle), so a report reads as a real record —
              what was flagged, why, when, and its current status — instead
              of one plain sentence. */}
          {!loading && view === 'reports' && (() => {
            // Reports still waiting come first, then the ones already reviewed
            // (most recently reviewed first), so the two never mix.
            const waitingList = data.filter((r) => r.status === 'open')
            const reviewedList = data
              .filter((r) => r.status !== 'open')
              .sort((x, y) => (y.resolved_at || y.ts) - (x.resolved_at || x.ts))
            const day = (ts) => new Date(ts * 1000).toLocaleDateString()
            const row = (r) => {
              const waiting = r.status === 'open'
              const verdict = waiting ? 'Waiting for review'
                : r.outcome === 'removed' ? 'Content removed'
                : r.outcome === 'no_change' ? 'Reviewed, no change'
                : 'Reviewed'
              return (
                <div key={r.id} className="fav-item report-item">
                  <span className="fav-info">
                    <span className="fav-icon fav-icon--flag"><FlagIcon width={16} height={16} /></span>
                    <span className="fav-text">
                      <span className="fav-title fav-title--wrap">{r.content_title}</span>
                      <span className="report-reason report-reason--wrap">{r.reason}</span>
                      {r.excerpt && <span className="report-reason report-reason--wrap">{r.excerpt}</span>}
                      {r.note && <span className="report-reply"><b>Note from our team:</b> {r.note}</span>}
                    </span>
                  </span>
                  <span className="report-meta">
                    <span className={`badge ${waiting ? 'badge-pending' : r.outcome === 'removed' ? 'badge-approved' : 'badge-neutral'}`}>{verdict}</span>
                    <span className="report-date">Reported {day(r.ts)}</span>
                    {!waiting && r.resolved_at && <span className="report-date">Reviewed {day(r.resolved_at)}</span>}
                  </span>
                </div>
              )
            }
            const both = waitingList.length > 0 && reviewedList.length > 0
            return (
              <>
                {waitingList.length > 0 && (
                  <section className="report-group">
                    {both && <h4 className="report-group-label">Waiting for review ({waitingList.length})</h4>}
                    {waitingList.map(row)}
                  </section>
                )}
                {reviewedList.length > 0 && (
                  <section className="report-group">
                    {both && <h4 className="report-group-label">Reviewed ({reviewedList.length})</h4>}
                    {reviewedList.map(row)}
                  </section>
                )}
              </>
            )
          })()}

          {!loading && view === 'insights' && data.map((t, i) => (
            <InsightsPanel key={i} trends={t} childName={child.name} />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!confirmingReport}
        icon={<FlagIcon width={20} height={20} />}
        title={confirmingReport ? (confirmingReport.chatTs != null ? 'Report this chat reply?' : `Report “${confirmingReport.title}”?`) : ''}
        message={<span className="dialog-line">Your reason: “{reportReason.trim()}”. A member of our team will review it. You can follow its status in the Reports tab.</span>}
        confirmLabel={reportBusy ? 'Sending…' : 'Send report'}
        cancelLabel="Go back"
        onConfirm={() => confirmingReport && submitReport(confirmingReport)}
        onCancel={() => setConfirmingReport(null)}
      />
      <ConfirmDialog
        open={confirmingLoginId}
        icon={<AlertIcon width={20} height={20} />}
        title="Generate a new Login ID?"
        message={<span className="dialog-line">The old one ({child.login_id}) stops working immediately, so {child.name} will need the new one to sign in.</span>}
        confirmLabel="Generate new"
        cancelLabel="Never mind"
        onConfirm={regenerateLoginId}
        onCancel={() => setConfirmingLoginId(false)}
      />
      <ConfirmDialog
        open={confirmingPin}
        icon={<AlertIcon width={20} height={20} />}
        title="Generate a new PIN?"
        message={<span className="dialog-line">The old one ({child.pin}) stops working immediately, so {child.name} will need the new one to sign in.</span>}
        confirmLabel="Generate new"
        cancelLabel="Never mind"
        onConfirm={regeneratePin}
        onCancel={() => setConfirmingPin(false)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        icon={<TrashIcon width={20} height={20} />}
        title={`Delete ${child.name}’s profile?`}
        message={<span className="dialog-line">This removes {child.name}&rsquo;s profile and its full history. This can&rsquo;t be undone.</span>}
        confirmLabel="Delete profile"
        cancelLabel="Never mind"
        onConfirm={() => { setConfirmingDelete(false); remove() }}
        onCancel={() => setConfirmingDelete(false)}
      />
      <ToastHost toast={toast} />
    </div>
  )
}

// PA08 — Edit Child Profile
function EditChild({ child, onDone }) {
  const [name, setName] = useState(child.name)
  const [dob, setDob] = useState(child.dob || '')
  const [gender, setGender] = useState(child.gender || '')
  const [interests, setInterests] = useState((child.interests || []).filter((i) => INTEREST_OPTIONS.includes(i)))
  const [readingLevel, setReadingLevel] = useState(child.reading_level || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    const missing = firstMissingField([[name, "Child's name"]])
    if (missing) { setError(missing); return }
    if (dobRangeProblem(dob)) { setError(dobRangeProblem(dob)); return }
    setError(''); setBusy(true)
    // A profile made before dates of birth existed keeps its stored age band
    // until a date is entered; once there is one, the band follows it.
    const payload = {
      name, reading_level: readingLevel || null,
      gender: gender || null, interests,
      ...(dob ? { dob } : {}),
    }
    try {
      await updateChild(child.id, payload)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    // .panel alone is a scroll-container class (max-height/overflow, built
    // for the session-browser/favourites lists) — no flex or gap of its
    // own, so this form's fields fell back to bare block stacking, same
    // gap-less look the "My account" edit form had before. Reusing that
    // same fix's class here instead of inventing a near-duplicate one.
    <form className="panel panel--flat account-edit-form child-form" onSubmit={save} noValidate>
      <label>Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field-group">
        <span className="field-group-label">Date of birth</span>
        <DobPicker value={dob} onChange={setDob} />
        <span className="field-hint">
          {child.dob
            ? 'The age band Pip uses updates automatically as they grow.'
            : `Currently set to ages ${child.age_band}. Add a date of birth to keep it up to date automatically.`}
        </span>
      </div>
      <label>Gender
        <Select value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Prefer not to say</option>
          <option value="girl">Girl</option>
          <option value="boy">Boy</option>
        </Select>
      </label>
      <label>Reading level
        <input value={readingLevel} onChange={(e) => setReadingLevel(e.target.value)} placeholder="e.g. early, middle" />
      </label>
      <div className="field-group">
        <span className="field-group-label">What do they love?</span>
        <InterestPicker value={interests} onChange={setInterests} />
      </div>
      <p className="muted p-wide">To change {child.name}&rsquo;s Login ID or PIN, use &ldquo;Generate new&rdquo; above. They&rsquo;re system-generated.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}

// PA21 — Adjust Safety Settings
function SafetySettings({ child, onDone }) {
  const s = child.settings || {}
  const [allowBooks, setAllowBooks] = useState(s.allow_books ?? true)
  const [allowVideos, setAllowVideos] = useState(s.allow_videos ?? true)
  const [blockExternal, setBlockExternal] = useState(s.block_external_links ?? true)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await updateChildSettings(child.id, {
        allow_books: allowBooks,
        allow_videos: allowVideos,
        block_external_links: blockExternal,
      })
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel panel--flat">
      <label className="toggle">
        <input type="checkbox" checked={allowBooks} onChange={(e) => setAllowBooks(e.target.checked)} />
        Allow book recommendations
      </label>
      <label className="toggle">
        <input type="checkbox" checked={allowVideos} onChange={(e) => setAllowVideos(e.target.checked)} />
        Allow video recommendations
      </label>
      <label className="toggle">
        <input type="checkbox" checked={blockExternal} onChange={(e) => setBlockExternal(e.target.checked)} />
        Block links that leave the app (recommended)
      </label>
      <div className="row">
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </div>
  )
}

// PA30 — Request Child Data Deletion
// Deliberately stays open after a request/cancel (no onDone close-out) — the
// scheduled/history status right below IS the confirmation the parent came
// here to see, unlike EditChild/SafetySettings where closing back to the
// list is the natural "done" signal.
function ChildDataPrivacy({ child }) {
  const [requests, setRequests] = useState([])
  const [counts, setCounts] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function load() {
    try { setRequests(await listChildDataDeletions(child.id)) } catch { /* ignore */ }
  }
  useEffect(() => {
    load()
    Promise.all([childActivity(child.id), childFavourites(child.id)])
      .then(([activity, favs]) => setCounts({ messages: activity.length, favourites: favs.length }))
      .catch(() => {})
  }, [])

  async function request() {
    setBusy(true)
    try { await requestChildDataDeletion(child.id); await load(); setConfirming(false) } finally { setBusy(false) }
  }

  async function cancelRequest(id) {
    await cancelChildDataDeletion(id)
    await load()
  }

  const fmt = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const fmtLong = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  const pending = requests.find((r) => r.status === 'pending')
  const past = requests.filter((r) => r.status !== 'pending')
  const daysLeft = pending ? Math.max(0, Math.ceil((pending.scheduled_for * 1000 - Date.now()) / 86400000)) : 0

  return (
    <div className="panel panel--flat">
      <div className="data-panel">
        <p className="insights-lead">What Pip keeps about {child.name}</p>
        <p className="data-intro">Chat history and saved favourites, so you can look back on them. You can ask for these to be deleted without removing the profile itself.</p>

        {counts && (
          <div className="insights-tiles">
            <div className="insights-tile"><span className="insights-num">{counts.messages}</span><span className="insights-label">chat messages</span></div>
            <div className="insights-tile insights-tile--warm"><span className="insights-num">{counts.favourites}</span><span className="insights-label">saved favourites</span></div>
          </div>
        )}

        {pending ? (
          <section className="data-box data-box--pending">
            <h4><ClockIcon width={16} height={16} /> Deletion scheduled for {fmt(pending.scheduled_for)}</h4>
            <p>{daysLeft > 1 ? `${daysLeft} days to go.` : daysLeft === 1 ? 'Tomorrow.' : 'Due today.'} Changed your mind? Cancel any time before then and nothing is removed.</p>
            <div className="row"><button className="ghost" onClick={() => cancelRequest(pending.id)}>Cancel this request</button></div>
          </section>
        ) : (
          <section className="data-box data-box--danger data-danger">
            <span className="data-danger-icon"><TrashIcon width={22} height={22} /></span>
            <div className="data-danger-body">
              <h4>Delete {child.name}&rsquo;s data</h4>
              <p>
                <span className="sentence">This removes {child.name}&rsquo;s chat history and saved favourites.</span>
                <span className="sentence">Deletion is scheduled 7 days out, so there is time to change your mind.</span>
              </p>
              <p className="data-danger-date">
                <ClockIcon width={14} height={14} />
                <span>Request it today and it runs on <b>{fmtLong(new Date(Date.now() + 7 * 86400000))}</b>. You can cancel any time before then.</span>
              </p>
            </div>
            <button className="danger data-danger-btn" onClick={() => setConfirming(true)}><TrashIcon width={15} height={15} /> Delete child data</button>
          </section>
        )}
        <ConfirmDialog
          open={confirming}
          icon={<TrashIcon width={20} height={20} />}
          title={`Delete ${child.name}’s data?`}
          message={<span className="dialog-line">This removes {child.name}&rsquo;s chat history and favourites. It runs in 7 days, and you can cancel before then.</span>}
          confirmLabel={busy ? 'Requesting…' : 'Request deletion'}
          cancelLabel="Not now"
          onConfirm={request}
          onCancel={() => setConfirming(false)}
        />

        {past.length > 0 && (
          <section className="insights-box">
            <h4>Earlier requests</h4>
            <ul className="data-history">
              {past.map((r) => (
                <li key={r.id}><span className="data-history-status">{r.status}</span><span>requested {fmt(r.requested_at)}</span></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
