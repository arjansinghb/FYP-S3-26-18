import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getToken, getMe, login, signup, logout,
  updateAccount, deleteAccount,
  listChildren, createChild, updateChild, deleteChild, updateChildSettings,
  childActivity, childFavourites, reportContent,
  requestVerification, confirmVerification,
  requestPasswordReset, confirmPasswordReset,
  giveConsent, getPrivacySettings, updatePrivacySettings,
  requestChildDataDeletion, listChildDataDeletions, cancelChildDataDeletion,
  listNotifications, markNotificationRead, getNotificationPreferences, updateNotificationPreferences,
  getSubscriptionStatus, subscribe as subscribeApi, cancelPremium, resumePremium, getBillingHistory, updatePaymentMethod,
  getPublicPlans,
  setContentOverride, listContentOverrides, clearContentOverride, unlockChild, regenerateChildPin, regenerateChildLoginId,
  childReports, childTrends, compareChildren,
  getMyReview, submitReview,
} from '../api'
import {
  AlertIcon, BellIcon, BookIcon, ChatIcon, CheckIcon, ClockIcon, FlagIcon, LockIcon,
  PlusIcon, SearchIcon, StarIcon, TrashIcon, UserIcon, VideoIcon,
} from '../icons'
import './parent.css'

// A book/video type icon in a tinted chip — same "icon-led title" pattern
// ModeratorDashboard.jsx's queue rows already use, applied here to the
// favourites list so a book/video isn't just a flat monochrome glyph
// sitting next to plain text (see .fav-icon in parent.css).
function TypeIcon({ type }) {
  const Icon = type === 'book' ? BookIcon : VideoIcon
  return <span className={`fav-icon fav-icon--${type}`}><Icon width={16} height={16} /></span>
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

// ---------- login / sign up ----------

function AuthPanel({ onAuthed }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const acc = mode === 'login'
        ? await login(email, password)
        : await signup(email, password, name)
      onAuthed(acc)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (forgot) return <ForgotPassword onBack={() => setForgot(false)} />

  return (
    <div className="parent auth">
      <Link className="home-link" to="/">← Home</Link>
      <h1>Parent {mode === 'login' ? 'Sign In' : 'Sign Up'}</h1>
      <form onSubmit={submit} className="card">
        {mode === 'signup' && (
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        <label>Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>
      <p className="muted">
        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <button className="linkbtn" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}>
          {mode === 'login' ? 'Sign up' : 'Sign in'}
        </button>
      </p>
      {mode === 'login' && (
        <p className="muted"><button className="linkbtn" onClick={() => setForgot(true)}>Forgot password?</button></p>
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
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function request(e) {
    e.preventDefault()
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
        <form onSubmit={request} className="card">
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Send reset link'}</button>
        </form>
      )}
      {step === 'confirm' && (
        <form onSubmit={confirm} className="card">
          {note && <p className="muted"><AlertIcon width={14} height={14} /> {note}</p>}
          <label>Reset token
            <input value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <label>New password
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
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

function Dashboard({ account, onAccountUpdated, onDeleted, onLogout }) {
  const [children, setChildren] = useState([])
  const [error, setError] = useState('')
  const [activeChildId, setActiveChildId] = useState('all') // PA35 switcher

  async function reload() {
    try { setChildren(await listChildren()) } catch (err) { setError(err.message) }
  }
  useEffect(() => { reload() }, [])

  const visibleChildren = activeChildId === 'all' ? children : children.filter((c) => c.id === activeChildId)

  return (
    <div className="parent">
      <Link className="home-link" to="/">← Home</Link>
      <header className="parent-header">
        <div className="parent-header-who">
          <div className="parent-header-role"><UserIcon width={20} height={20} /></div>
          <div>
            <h1>Parent Dashboard</h1>
            <p className="muted">Signed in as {account.name} ({account.email})</p>
          </div>
        </div>
        <div className="row">
          <NotificationsBell />
          <button className="ghost" onClick={onLogout}>Log out</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {!account.verified && <VerifyBanner account={account} onAccountUpdated={onAccountUpdated} />}

      <AccountPanel account={account} onUpdated={onAccountUpdated} onDeleted={onDeleted} />

      <AddChild account={account} onAccountUpdated={onAccountUpdated} onAdded={reload} childCount={children.length} />

      <h2><UserIcon width={20} height={20} /> Your children ({children.length})</h2>
      {children.length === 0 && <p className="muted">No child profiles yet. Add one above.</p>}

      {children.length > 1 && (
        // PA35 — Switch Between Child Profiles (Premium)
        <div className="tabs">
          <button className={`tab ${activeChildId === 'all' ? 'active' : ''}`} onClick={() => setActiveChildId('all')}>All children</button>
          {children.map((c) => (
            <button key={c.id} className={`tab ${activeChildId === c.id ? 'active' : ''}`} onClick={() => setActiveChildId(c.id)}>{c.name}</button>
          ))}
        </div>
      )}

      {account.tier === 'premium' && children.length > 1 && activeChildId === 'all' && (
        <CompareChildrenPanel />
      )}

      <div className="child-grid">
        {visibleChildren.map((c) => (
          <ChildCard key={c.id} child={c} account={account} onChanged={reload} />
        ))}
      </div>

      <NotificationSettings />

      <SubscriptionPanel account={account} onAccountUpdated={onAccountUpdated} />

      <ReviewPanel />

      <PrivacyPanel account={account} />
    </div>
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
  const [rating, setRating] = useState(5)
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
    if (!text.trim()) { setError('Write a few words first.'); return }
    setBusy(true); setError('')
    try {
      const saved = await submitReview(rating, text.trim())
      setReview(saved)
      setText('')
      setRating(5)
      setJustSubmitted(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (review === undefined) return null // avoid a flash of the form before we know

  return (
    <div className="card">
      <h3><StarIcon width={18} height={18} filled /> Your review</h3>
      {justSubmitted ? (
        <div className="review-submitted review-submitted-thanks">
          <CheckIcon width={20} height={20} />
          <p className="review-submitted-text">Thank you for your feedback!</p>
        </div>
      ) : (
        <form className="review-form" onSubmit={submit}>
          {review?.status === 'rejected' && (
            <p className="review-rejected-note">Your last submission wasn't published — {review.rejection_reason || 'try rewording it.'} Feel free to try again.</p>
          )}
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

function VerifyBanner({ account, onAccountUpdated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  // Dev mode only: signup (or a resend below) can hand back a real token
  // when no email service is configured — prefilling it keeps local/no-key
  // testing exactly as easy as before this change. In real-email mode the
  // backend never sends a token back, so this just stays empty and the
  // parent has to actually check their inbox and type the code in.
  const [code, setCode] = useState(account.verify_token || '')

  async function sendCode() {
    setBusy(true); setError('')
    try {
      const res = await requestVerification()
      if (res.token) setCode(res.token)
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function verifyNow(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const updated = await confirmVerification(code)
      onAccountUpdated({ ...account, ...updated })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const haveCode = sent || !!code

  return (
    <div className="card" style={{ background: 'var(--primary-100)', borderColor: 'var(--primary-border)' }}>
      <p><AlertIcon width={16} height={16} /> <b>Please verify your email</b> — needed before you can add a child profile.</p>
      <p className="muted">
        {code
          ? 'Dev mode: no email service is configured, so your code is filled in below already.'
          : `We'll send a verification code to ${account.email}.`}
      </p>
      {error && <p className="error">{error}</p>}
      <form onSubmit={verifyNow} className="row">
        {!haveCode && <button type="button" onClick={sendCode} disabled={busy}>{busy ? 'Sending…' : 'Send verification code'}</button>}
        {haveCode && (
          <>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code from email" required style={{ maxWidth: 160 }} />
            <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
            <button type="button" className="linkbtn" onClick={sendCode} disabled={busy}>Resend code</button>
          </>
        )}
      </form>
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
                <span className="notif-body">{n.body}</span>
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

  useEffect(() => { getNotificationPreferences().then(setPrefs).catch(() => {}) }, [])

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

  if (!prefs) return null

  return (
    <section className="card">
      <h3><BellIcon width={18} height={18} /> Notifications</h3>
      <p className="muted">Get told when something needs your attention — a report gets resolved, a child activates their profile.</p>
      <label className="toggle">
        <input type="checkbox" checked={prefs.channels.in_app} onChange={() => toggle('in_app')} disabled={saving} />
        In-app — shows in the bell icon above
      </label>
      <label className="toggle">
        <input type="checkbox" checked={prefs.channels.email} onChange={() => toggle('email')} disabled={saving} />
        Email
      </label>
      <label className="toggle">
        <input type="checkbox" checked={prefs.channels.push} onChange={() => toggle('push')} disabled={saving} />
        Push
      </label>
      <p className="muted">Email and push are saved as a preference but aren't wired to a real delivery service in this prototype yet — only in-app notifications actually appear right now.</p>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

// ---------- account: view / edit / delete (PA04/PA05/PA06) ----------

function AccountPanel({ account, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(account.name)
  const [email, setEmail] = useState(account.email)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    const payload = { name, email }
    if (password) payload.password = password
    try {
      const updated = await updateAccount(payload)
      onUpdated({ ...account, ...updated })
      setPassword('')
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Delete your account? This permanently removes your profile and ALL your child profiles and their data. This cannot be undone.')) return
    await deleteAccount()
    onDeleted()
  }

  return (
    <section className="card">
      <div className="child-top">
        <h3>My account</h3>
        {!editing && <button className="ghost small" onClick={() => setEditing(true)}>Edit</button>}
      </div>

      {!editing ? (
        <>
          <p className="muted">Name: <b>{account.name}</b></p>
          <p className="muted">
            Email: <b>{account.email}</b>{' '}
            <span className={`badge ${account.verified ? 'badge-approved' : 'badge-pending'}`}>
              {account.verified ? 'verified' : 'not verified'}
            </span>
          </p>
          <p className="muted">Plan: <b>{account.tier === 'premium' ? 'Premium' : 'Free'}</b></p>
          <div className="row">
            <button className="danger small" onClick={remove}><TrashIcon width={15} height={15} /> Delete account</button>
          </div>
        </>
      ) : (
        <form onSubmit={save}>
          <label>Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>New password (leave blank to keep current)
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className="ghost" onClick={() => { setEditing(false); setName(account.name); setEmail(account.email); setPassword(''); setError('') }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  )
}

// ---------- PA23-27: subscription / billing (simulated) ----------

// Ultra tier (2026-09-07, Kiefer's own ask) — same Premium features plus
// unlimited child profiles (Premium stays capped at 4). Kept as one small
// lookup instead of scattering "premium vs ultra" copy across the JSX
// below, so the two tiers' descriptions/prices stay next to each other.
const TIER_INFO = {
  premium: { label: 'Premium', desc: 'Up to 4 child profiles, unlimited favourites, full activity trends, multi-child comparison.' },
  ultra: { label: 'Ultra', desc: 'Everything in Premium, plus unlimited child profiles — no cap for larger families.' },
}

function SubscriptionPanel({ account, onAccountUpdated }) {
  const [status, setStatus] = useState(null)
  const [plans, setPlans] = useState(null)
  const [history, setHistory] = useState([])
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradeTier, setUpgradeTier] = useState('premium')
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

  async function reload() {
    try { setStatus(await getSubscriptionStatus()) } catch { /* ignore */ }
  }
  useEffect(() => { reload() }, [account.tier])
  useEffect(() => { getPublicPlans().then(setPlans).catch(() => {}) }, [])

  function priceFor(tier, cycle) {
    if (!plans) return null
    return plans[`${tier}_${cycle}_price`]
  }

  async function subscribe(e, tier) {
    e.preventDefault()
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

  async function cancel() {
    if (!confirm(`Cancel your ${TIER_INFO[status.tier]?.label} subscription? It stays active until the end of the current billing period.`)) return
    const s = await cancelPremium()
    setStatus(s)
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

  if (!status) return null
  const price = priceFor(upgradeTier, billingCycle)

  // Shared by both paid tiers below — card-on-file management + cancel/
  // resume is identical either way, only the tier name/description
  // differs. A plain function returning JSX, called inline (not
  // `<PaidTierBody .../>`) — defining an actual component in here would
  // give it a fresh identity every render, so React would remount its
  // whole subtree (and drop input focus mid-keystroke in the card-update
  // form below) every time any of this panel's own state changes.
  function paidTierBody(tier) {
    return (
      <>
        <p className="muted">{TIER_INFO[tier].desc}</p>
        {status.payment_method && !editingCard && (
          <p className="muted">
            Card on file: {status.payment_method.brand} •••• {status.payment_method.last4}{' '}
            <button className="linkbtn" onClick={() => { setNewCardBrand(status.payment_method.brand); setEditingCard(true) }}>Update</button>
          </p>
        )}
        {editingCard && (
          <form onSubmit={updateCard}>
            <label>Card brand
              <input value={newCardBrand} onChange={(e) => setNewCardBrand(e.target.value)} required />
            </label>
            <label>Card last 4 digits (simulated — no real charge)
              <input value={newCardLast4} onChange={(e) => setNewCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} minLength={4} maxLength={4} required />
            </label>
            {cardError && <p className="error">{cardError}</p>}
            <div className="row">
              <button type="submit" disabled={cardBusy}>{cardBusy ? 'Saving…' : 'Save card'}</button>
              <button type="button" className="ghost" onClick={() => setEditingCard(false)}>Cancel</button>
            </div>
          </form>
        )}
        {tier === 'premium' && !status.cancel_at && (
          <div className="row">
            <button onClick={() => { setUpgradeTier('ultra'); setShowUpgrade(true) }}>
              <StarIcon width={16} height={16} /> Upgrade to Ultra
            </button>
          </div>
        )}
        {showUpgrade && upgradeTier === 'ultra' && tier === 'premium' && (
          <form onSubmit={(e) => subscribe(e, 'ultra')}>
            <label>Billing cycle
              <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
                <option value="monthly">Monthly — ${priceFor('ultra', 'monthly')?.toFixed(2)}</option>
                <option value="annual">Annual — ${priceFor('ultra', 'annual')?.toFixed(2)}</option>
              </select>
            </label>
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button type="submit" disabled={busy}>{busy ? 'Processing…' : 'Confirm upgrade'}</button>
              <button type="button" className="ghost" onClick={() => setShowUpgrade(false)}>Cancel</button>
            </div>
          </form>
        )}
        {status.cancel_at
          ? (
            <>
              <p className="muted"><AlertIcon width={14} height={14} /> Cancels on {new Date(status.cancel_at * 1000).toLocaleDateString()} — you'll drop to Free after that.</p>
              <div className="row"><button className="ghost" onClick={resume}>Resume subscription</button></div>
            </>
          )
          : <div className="row"><button className="danger" onClick={cancel}>Cancel subscription</button></div>}
      </>
    )
  }

  return (
    <section className="card">
      <div className="child-top">
        <h3>Subscription</h3>
        <span className={`badge ${status.tier === 'free' ? 'badge-pending' : 'badge-approved'}`}>{status.tier}</span>
      </div>

      {status.tier === 'free' && (
        <>
          <p className="muted">Free plan: 1 child profile, 5 saved favourites per child, basic activity log.</p>
          {!showUpgrade
            ? (
              <div className="row">
                <button onClick={() => { setUpgradeTier('premium'); setShowUpgrade(true) }}><StarIcon width={16} height={16} /> Upgrade to Premium</button>
                <button className="ghost" onClick={() => { setUpgradeTier('ultra'); setShowUpgrade(true) }}><StarIcon width={16} height={16} /> Upgrade to Ultra</button>
              </div>
            )
            : (
              <form onSubmit={(e) => subscribe(e, upgradeTier)}>
                <label>Plan
                  <select value={upgradeTier} onChange={(e) => setUpgradeTier(e.target.value)}>
                    <option value="premium">Premium — {TIER_INFO.premium.desc}</option>
                    <option value="ultra">Ultra — {TIER_INFO.ultra.desc}</option>
                  </select>
                </label>
                <label>Billing cycle
                  <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
                    <option value="monthly">Monthly — ${price?.toFixed(2)}</option>
                    <option value="annual">Annual — ${priceFor(upgradeTier, 'annual')?.toFixed(2)}</option>
                  </select>
                </label>
                <label>Card brand
                  <input value={cardBrand} onChange={(e) => setCardBrand(e.target.value)} />
                </label>
                <label>Card last 4 digits (simulated — no real charge)
                  <input value={cardLast4} onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} minLength={4} maxLength={4} required />
                </label>
                {error && <p className="error">{error}</p>}
                <div className="row">
                  <button type="submit" disabled={busy}>{busy ? 'Processing…' : `Confirm ${TIER_INFO[upgradeTier].label} subscription`}</button>
                  <button type="button" className="ghost" onClick={() => setShowUpgrade(false)}>Cancel</button>
                </div>
              </form>
            )}
        </>
      )}

      {status.tier === 'premium' && paidTierBody('premium')}
      {status.tier === 'ultra' && paidTierBody('ultra')}

      <div className="row">
        <button className="ghost small" onClick={openHistory}>{showHistory ? 'Hide' : 'View'} billing history</button>
      </div>
      {showHistory && (
        <div className="panel">
          {history.length === 0 && <p className="muted">No transaction history.</p>}
          {history.map((b) => (
            <div key={b.id} className="fav-item">
              <span>{b.description}</span>
              <span>${(b.amount_cents / 100).toFixed(2)} · {new Date(b.ts * 1000).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ---------- PA29: data & privacy settings ----------

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
      <section className="card">
        <h3>Data &amp; Privacy</h3>
        <p className="muted">Available once you've provided parental consent (see "Add a child profile" below).</p>
      </section>
    )
  }
  if (!settings) return null

  return (
    <section className="card">
      <h3>Data &amp; Privacy</h3>
      <p className="muted">Controls how long your child's activity data is kept, per PDPA.</p>
      <label>Retention preference
        <select value={settings.retention_preference} disabled={busy} onChange={(e) => change(e.target.value)}>
          <option value="standard">Standard (default retention period)</option>
          <option value="minimal">Minimal (keep only what's needed right now)</option>
        </select>
      </label>
    </section>
  )
}

// ---------- PA28 consent (shown inline, right where it's triggered) ----------

function ConsentStep({ account, onAccountUpdated, onDone }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
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
    <form onSubmit={submit} className="card" style={{ background: 'var(--primary-100)' }}>
      <h3>Before you add a child…</h3>
      <p className="muted">
        Under PDPA, we need your verifiable consent before collecting any data about your child —
        name, age band, chat activity, and saved favourites. Re-enter your password to confirm you're
        the account holder and agree to this.
      </p>
      <label>Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Confirming…' : 'I agree — continue'}</button>
    </form>
  )
}

function AddChild({ account, onAccountUpdated, onAdded, childCount }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [ageBand, setAgeBand] = useState('5-8')
  const [readingLevel, setReadingLevel] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      // No pin field — the server generates a unique 6-digit linking
      // code/PIN itself (see models.ChildCreate's docstring for why letting
      // a parent type one caused real collisions between families).
      await createChild({ name, age_band: ageBand, reading_level: readingLevel || null })
      setName(''); setReadingLevel(''); setAgeBand('5-8'); setOpen(false)
      onAdded()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button className="add-btn" onClick={() => setOpen(true)}>
        <PlusIcon width={16} height={16} /> Add a child profile {childCount >= 1 && account.tier !== 'premium' ? '(Premium required for more than 1)' : ''}
      </button>
    )
  }

  if (!account.verified) {
    return <VerifyBanner account={account} onAccountUpdated={onAccountUpdated} />
  }
  if (!account.consent) {
    return <ConsentStep account={account} onAccountUpdated={onAccountUpdated} onDone={() => {}} />
  }

  return (
    <form onSubmit={submit} className="card">
      <h3>New child profile</h3>
      <label>Child's name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>Age band
        <select value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
          <option value="5-8">5–8</option>
          <option value="9-12">9–12</option>
        </select>
      </label>
      <label>Reading level (optional)
        <input value={readingLevel} onChange={(e) => setReadingLevel(e.target.value)} placeholder="e.g. early, middle" />
      </label>
      <p className="muted">A 6-digit linking code/PIN will be generated automatically — you'll see it on the child's card right after creating the profile, ready to give to your child.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create profile'}</button>
        <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

// ---------- PA32: multi-child comparison (Premium) ----------

function CompareChildrenPanel() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    compareChildren().then(setRows).catch((err) => setError(err.message))
  }, [])

  if (error) return null
  if (!rows) return <p className="muted">Loading comparison…</p>

  return (
    <section className="card">
      <h3>Compare Children</h3>
      <div className="child-grid">
        {rows.map((r) => (
          <div key={r.child_id} className="child-card">
            <h3>{r.name}</h3>
            <p className="muted">{r.total_messages} messages · {r.total_recommendations} recommendations · {r.favourites_count} favourites</p>
            <p className="muted">Top genres: {r.top_genres.length ? r.top_genres.join(', ') : '—'}</p>
          </div>
        ))}
      </div>
    </section>
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

function ChildCard({ child, account, onChanged }) {
  const [view, setView] = useState(null) // 'activity' | 'favourites' | 'edit' | 'safety' | 'reports' | 'insights' | 'privacy' | null
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [overrides, setOverrides] = useState({})
  const [openSessionId, setOpenSessionId] = useState(null)
  // PA14 — a search box over the session list, so a parent with a long
  // chat history finds a specific conversation directly instead of
  // scrolling the whole thing looking for it.
  const [activitySearch, setActivitySearch] = useState('')

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
      else if (which === 'insights') setData([await childTrends(child.id)])
      else setData([])
    } catch {
      setData([])
    } finally {
      setLoading(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete ${child.name}'s profile? This cannot be undone.`)) return
    await deleteChild(child.id)
    onChanged()
  }

  async function report(item) {
    const reason = prompt(`Why are you reporting "${item.title}"?`)
    if (!reason) return
    await reportContent(child.id, item.id, reason)
    alert('Thanks — this has been reported to the moderators.')
    if (view === 'favourites') toggle('favourites')
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
    if (!confirm(`Generate a new PIN for ${child.name}? The old one (${child.pin}) will stop working immediately.`)) return
    await regenerateChildPin(child.id)
    onChanged()
  }

  async function regenerateLoginId() {
    if (!confirm(`Generate a new Login ID for ${child.name}? The old one (${child.login_id}) will stop working immediately.`)) return
    await regenerateChildLoginId(child.id)
    onChanged()
  }

  return (
    <div className="child-card">
      <div className="child-top">
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {child.name} {child.locked && <span className="badge badge-rejected"><LockIcon width={10} height={10} /> locked</span>}
          </h3>
          <p className="muted">Age {child.age_band}{child.reading_level ? ` · ${child.reading_level}` : ''}</p>
        </div>
        <button className="ghost small" onClick={remove}>Delete</button>
      </div>

      {child.locked && (
        <div className="card" style={{ background: 'var(--danger-100)', margin: '10px 0' }}>
          <p className="muted">Too many wrong PIN attempts — {child.name} is locked out of the chat until you unlock it.</p>
          <div className="row"><button onClick={unlock}>Unlock profile</button></div>
        </div>
      )}

      <div className="linking">
        <span className="muted">Give these to your child to sign in — both generated automatically:</span>
        <div className="linking-row">
          <span className="linking-label">Login ID</span>
          <code className="code">{child.login_id}</code>
          <button className="ghost small" onClick={regenerateLoginId}>Generate new</button>
        </div>
        <div className="linking-row">
          <span className="linking-label">PIN</span>
          <code className="code">{child.pin}</code>
          <button className="ghost small" onClick={regeneratePin}>Generate new</button>
        </div>
      </div>

      <div className="row">
        <button className="small" onClick={() => toggle('activity')}>Activity</button>
        <button className="small" onClick={() => toggle('favourites')}>Favourites</button>
        <button className="small" onClick={() => toggle('reports')}>Reports</button>
        {account.tier === 'premium' && <button className="small" onClick={() => toggle('insights')}>Insights</button>}
        <button className="small ghost" onClick={() => toggle('edit')}>Edit</button>
        <button className="small ghost" onClick={() => toggle('safety')}>Safety</button>
        <button className="small ghost" onClick={() => toggle('privacy')}>Data</button>
      </div>

      {view === 'edit' && <EditChild child={child} onDone={() => { setView(null); onChanged() }} />}
      {view === 'safety' && <SafetySettings child={child} onDone={() => { setView(null); onChanged() }} />}
      {view === 'privacy' && <ChildDataPrivacy child={child} />}

      {(view === 'activity' || view === 'favourites' || view === 'reports' || view === 'insights') && (
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
                {open && (
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
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {!loading && view === 'favourites' && data.map((f) => (
            <div key={f.id} className="fav-item">
              <span className="fav-info">
                <TypeIcon type={f.type} />
                <span className="fav-text">
                  <span className="fav-title">{f.title}</span>
                  <span className="fav-type">{f.type === 'book' ? 'Book' : 'Video'}</span>
                </span>
              </span>
              <div className="row">
                {f.type === 'book' && <button className="ghost small" onClick={() => accessOptions(f)}>Access Options</button>}
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
                <button className="ghost small" onClick={() => report(f)}><FlagIcon width={14} height={14} /> Report</button>
              </div>
            </div>
          ))}

          {!loading && view === 'reports' && data.map((r) => (
            <div key={r.id} className="fav-item">
              <span>{r.content_title} — {r.reason}</span>
              <span className={`badge ${r.status === 'open' ? 'badge-pending' : 'badge-approved'}`}>{r.status}</span>
            </div>
          ))}

          {!loading && view === 'insights' && data.map((t, i) => (
            <div key={i}>
              {/* A glance, not a paragraph — same stat-tile pattern the
                  Admin console's System Health uses, so a parent scanning
                  for "is everything okay" doesn't have to read a sentence
                  to get three numbers. */}
              <div className="stat-grid">
                <div className="stat"><div className="stat-num">{t.total_messages}</div><div className="stat-label">Messages</div></div>
                <div className="stat"><div className="stat-num">{t.total_recommendations}</div><div className="stat-label">Recommendations</div></div>
                <div className="stat"><div className="stat-num">{t.favourites_count}</div><div className="stat-label">Favourites</div></div>
              </div>
              {t.total_messages < 3
                ? <p className="muted" style={{ marginTop: 10 }}>Not enough activity yet to show trends — check back after a few more chats.</p>
                : (
                  <p className="muted" style={{ marginTop: 10 }}>
                    Top genres: <b style={{ color: 'var(--ink)' }}>{t.top_genres.join(', ') || '—'}</b>
                  </p>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// PA08 — Edit Child Profile
function EditChild({ child, onDone }) {
  const [name, setName] = useState(child.name)
  const [ageBand, setAgeBand] = useState(child.age_band)
  const [readingLevel, setReadingLevel] = useState(child.reading_level || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    const payload = { name, age_band: ageBand, reading_level: readingLevel || null }
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
    <form className="panel" onSubmit={save}>
      <label>Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>Age band
        <select value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
          <option value="5-8">5–8</option>
          <option value="9-12">9–12</option>
        </select>
      </label>
      <label>Reading level
        <input value={readingLevel} onChange={(e) => setReadingLevel(e.target.value)} placeholder="e.g. early, middle" />
      </label>
      <p className="muted">To change {child.name}'s code/PIN, use "Generate new code" on their card instead — it's system-generated, not typed in.</p>
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
    <div className="panel">
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
  const [busy, setBusy] = useState(false)

  async function load() {
    try { setRequests(await listChildDataDeletions(child.id)) } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])

  async function request() {
    if (!confirm(`Request deletion of ${child.name}'s chat history and favourites? This is scheduled to take effect in 7 days — you can cancel any time before then.`)) return
    setBusy(true)
    try { await requestChildDataDeletion(child.id); await load() } finally { setBusy(false) }
  }

  async function cancelRequest(id) {
    await cancelChildDataDeletion(id)
    await load()
  }

  const pending = requests.find((r) => r.status === 'pending')

  return (
    <div className="panel">
      <p className="muted">Request deletion of {child.name}'s stored chat history and favourites (separate from deleting the whole profile).</p>
      {pending ? (
        <>
          <p className="muted"><ClockIcon width={14} height={14} /> Deletion scheduled for {new Date(pending.scheduled_for * 1000).toLocaleDateString()}.</p>
          <div className="row"><button className="ghost" onClick={() => cancelRequest(pending.id)}>Cancel this request</button></div>
        </>
      ) : (
        <div className="row"><button className="danger" onClick={request} disabled={busy}>{busy ? 'Requesting…' : 'Delete child data'}</button></div>
      )}
      {requests.filter((r) => r.status !== 'pending').length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 10 }}>History:</p>
          {requests.filter((r) => r.status !== 'pending').map((r) => (
            <p key={r.id} className="muted">{r.status} — requested {new Date(r.requested_at * 1000).toLocaleDateString()}</p>
          ))}
        </>
      )}
    </div>
  )
}
