import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getToken, getMe, login, signup, logout,
  updateAccount, deleteAccount,
  listChildren, createChild, updateChild, deleteChild, updateChildSettings,
  childActivity, childFavourites, reportContent,
  requestVerification, confirmVerification,
  requestPasswordReset, confirmPasswordReset,
  giveConsent,
  getSubscriptionStatus, subscribe as subscribeApi, cancelPremium, resumePremium, getBillingHistory, updatePaymentMethod,
  getPublicPlans,
  setContentOverride, listContentOverrides, clearContentOverride, unlockChild, regenerateChildPin, regenerateChildLoginId,
  childReports,
} from '../api'
import {
  AlertIcon, BookIcon, ChatIcon, CheckIcon, ClockIcon, FlagIcon, LockIcon,
  PlusIcon, SearchIcon, StarIcon, TrashIcon, UserIcon, VideoIcon,
} from '../icons'
import { useToast, ToastHost } from '../components/Toast'
import Select from '../components/Select'
import { firstMissingField } from '../formValidation'
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
    const missing = firstMissingField(mode === 'signup'
      ? [[name, 'Your name'], [email, 'Email'], [password, 'Password']]
      : [[email, 'Email'], [password, 'Password']])
    if (missing) { setError(missing); return }
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
      <form onSubmit={submit} className="card" noValidate>
        {mode === 'signup' && (
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label>Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} />
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
    const missing = firstMissingField([[email, 'Email']])
    if (missing) { setError(missing); return }
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
    const missing = firstMissingField([[token, 'Reset token'], [newPassword, 'New password']])
    if (missing) { setError(missing); return }
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
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} />
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

  // Landing page's pricing buttons send an already-logged-in parent to
  // "/parent#subscription" instead of the plain dashboard root. The
  // Subscription card loads its own data async (see SubscriptionPanel)
  // and only renders once that's back, so the target element doesn't
  // necessarily exist yet on the first paint — poll briefly rather than
  // scrolling too early and missing it entirely.
  useEffect(() => {
    if (window.location.hash !== '#subscription') return
    let attempts = 0
    const id = setInterval(() => {
      const el = document.getElementById('subscription')
      attempts += 1
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        clearInterval(id)
      } else if (attempts > 20) {
        clearInterval(id) // gave up after ~2s — never loaded, nothing to scroll to
      }
    }, 100)
    return () => clearInterval(id)
  }, [])

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

      <div className="child-grid">
        {visibleChildren.map((c) => (
          <ChildCard key={c.id} child={c} account={account} onChanged={reload} />
        ))}
      </div>

      <SubscriptionPanel account={account} onAccountUpdated={onAccountUpdated} />
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
    const missing = firstMissingField([[code, 'Code from email']])
    if (missing) { setError(missing); return }
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
      <form onSubmit={verifyNow} className="row" noValidate>
        {!haveCode && <button type="button" onClick={sendCode} disabled={busy}>{busy ? 'Sending…' : 'Send verification code'}</button>}
        {haveCode && (
          <>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code from email" style={{ maxWidth: 160 }} />
            <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
            <button type="button" className="linkbtn" onClick={sendCode} disabled={busy}>Resend code</button>
          </>
        )}
      </form>
    </div>
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
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function save(e) {
    e.preventDefault()
    const missing = firstMissingField([[name, 'Name'], [email, 'Email']])
    if (missing) { setError(missing); return }
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
          {confirmingDelete ? (
            <div className="row inline-confirm">
              <span>Delete your account? This removes your profile and ALL child profiles and their data — permanently.</span>
              <button className="danger small" onClick={remove}>Yes, delete everything</button>
              <button className="ghost small" onClick={() => setConfirmingDelete(false)}>Cancel</button>
            </div>
          ) : (
            <div className="row">
              <button className="danger small" onClick={() => setConfirmingDelete(true)}><TrashIcon width={15} height={15} /> Delete account</button>
            </div>
          )}
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
          <label>New password<span className="muted"> (leave blank to keep current)</span>
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
// trimmed-demo branch: one paid tier only (Premium) — Ultra removed, see
// models.AccountTier's comment.
const TIER_INFO = {
  premium: { label: 'Premium', desc: 'Up to 4 child profiles, unlimited favourites.' },
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

  async function subscribe(e, tier) {
    e.preventDefault()
    if (!status?.payment_method) {
      const missing = firstMissingField([[cardBrand, 'Card brand'], [cardLast4, 'Card last 4 digits']])
      if (missing) { setError(missing); return }
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
          <form onSubmit={updateCard} noValidate>
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
            <>
              <p className="muted"><AlertIcon width={14} height={14} /> Cancels on {new Date(status.cancel_at * 1000).toLocaleDateString()} — you'll drop to Free after that.</p>
              <div className="row"><button className="ghost" onClick={resume}>Resume subscription</button></div>
            </>
          )
          : confirmingCancel ? (
            <div className="row inline-confirm">
              <span>Cancel your {TIER_INFO[status.tier]?.label} subscription? Stays active until the end of the current billing period.</span>
              <button className="danger small" onClick={cancel}>Yes, cancel</button>
              <button className="ghost small" onClick={() => setConfirmingCancel(false)}>Never mind</button>
            </div>
          ) : (
            <div className="row"><button className="danger" onClick={() => setConfirmingCancel(true)}>Cancel subscription</button></div>
          )}
      </>
    )
  }

  return (
    // id lets the landing page's pricing buttons ("Get Premium plan" etc.)
    // jump an already-logged-in parent straight here instead of dropping
    // them at the top of the dashboard — see Dashboard's own scroll-to-
    // hash effect and Home.jsx's plan-grid Links.
    <section className="card" id="subscription">
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
              </div>
            )
            : (
              <form onSubmit={(e) => subscribe(e, upgradeTier)} noValidate>
                <label>Billing cycle
                  <Select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
                    <option value="monthly">Monthly — ${price?.toFixed(2)}</option>
                    <option value="annual">Annual — ${priceFor(upgradeTier, 'annual')?.toFixed(2)}</option>
                  </Select>
                </label>
                <div className="field-row">
                  <label>Card brand
                    <input value={cardBrand} onChange={(e) => setCardBrand(e.target.value)} />
                  </label>
                  <label>Card last 4 digits
                    <input value={cardLast4} onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} minLength={4} maxLength={4} />
                  </label>
                </div>
                <p className="muted">Simulated billing — no real charge.</p>
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

// ---------- PA28 consent (shown inline, right where it's triggered) ----------

function ConsentStep({ account, onAccountUpdated, onDone }) {
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
    <form onSubmit={submit} className="card" style={{ background: 'var(--primary-100)' }} noValidate>
      <h3>Before you add a child…</h3>
      <p className="muted">
        Under PDPA, we need your verifiable consent before collecting any data about your child —
        name, age band, chat activity, and saved favourites. Re-enter your password to confirm you're
        the account holder and agree to this.
      </p>
      <label>Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
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
    const missing = firstMissingField([[name, "Child's name"]])
    if (missing) { setError(missing); return }
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
    <form onSubmit={submit} className="card" noValidate>
      <h3>New child profile</h3>
      <label>Child's name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>Age band
        <Select value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
          <option value="5-8">5–8</option>
          <option value="9-12">9–12</option>
        </Select>
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
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingLoginId, setConfirmingLoginId] = useState(false)
  const [confirmingPin, setConfirmingPin] = useState(false)
  // PA16 report-content — was a native prompt() for the reason plus a
  // native alert() on success; per-item id (not a bare boolean) since this
  // card can list several favourites, each with its own Report button.
  const [reportingId, setReportingId] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
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
      await reportContent(child.id, item.id, reportReason.trim())
      notify?.(`“${item.title}” reported — a member of our team will take a look.`)
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
    <div className="child-card">
      <div className="child-top">
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {child.name} {child.locked && <span className="badge badge-rejected"><LockIcon width={10} height={10} /> locked</span>}
          </h3>
          <p className="muted">Age {child.age_band}{child.reading_level ? ` · ${child.reading_level}` : ''}</p>
        </div>
        {!confirmingDelete && <button className="ghost small" onClick={() => setConfirmingDelete(true)}>Delete</button>}
      </div>

      {confirmingDelete && (
        <div className="row inline-confirm">
          <span>Delete {child.name}'s profile? This cannot be undone.</span>
          <button className="danger small" onClick={remove}>Yes, delete</button>
          <button className="ghost small" onClick={() => setConfirmingDelete(false)}>Cancel</button>
        </div>
      )}

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
          {!confirmingLoginId && <button className="ghost small" onClick={() => setConfirmingLoginId(true)}>Generate new</button>}
        </div>
        {confirmingLoginId && (
          <div className="row inline-confirm">
            <span>New Login ID? The old one ({child.login_id}) stops working immediately.</span>
            <button className="danger small" onClick={regenerateLoginId}>Yes, generate new</button>
            <button className="ghost small" onClick={() => setConfirmingLoginId(false)}>Cancel</button>
          </div>
        )}
        <div className="linking-row">
          <span className="linking-label">PIN</span>
          <code className="code">{child.pin}</code>
          {!confirmingPin && <button className="ghost small" onClick={() => setConfirmingPin(true)}>Generate new</button>}
        </div>
        {confirmingPin && (
          <div className="row inline-confirm">
            <span>New PIN? The old one ({child.pin}) stops working immediately.</span>
            <button className="danger small" onClick={regeneratePin}>Yes, generate new</button>
            <button className="ghost small" onClick={() => setConfirmingPin(false)}>Cancel</button>
          </div>
        )}
      </div>

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
        <button className={view === 'reports' ? 'tab active' : 'tab'} onClick={() => toggle('reports')}>Reports</button>
        <button className={view === 'edit' ? 'tab active' : 'tab'} onClick={() => toggle('edit')}>Edit</button>
        <button className={view === 'safety' ? 'tab active' : 'tab'} onClick={() => toggle('safety')}>Safety</button>
      </div>

      {view === 'edit' && <EditChild child={child} onDone={() => { setView(null); onChanged() }} />}
      {view === 'safety' && <SafetySettings child={child} onDone={() => { setView(null); onChanged() }} />}

      {(view === 'activity' || view === 'favourites' || view === 'reports') && (
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
            <div key={f.id} className={`fav-item ${reportingId === f.id ? 'fav-item--reporting' : ''}`}>
              <span className="fav-info">
                <TypeIcon type={f.type} />
                <span className="fav-text">
                  <span className="fav-title">{f.title}</span>
                  <span className="fav-type">{f.type === 'book' ? 'Book' : 'Video'}</span>
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
                  onSubmit={(e) => { e.preventDefault(); submitReport(f) }}
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
                  <button className="ghost small" onClick={() => { setReportingId(f.id); setReportReason('') }}><FlagIcon width={14} height={14} /> Report</button>
                </div>
              )}
            </div>
          ))}

          {/* PA17 — was a single bare line of "title — reason" plus a
              status badge, no icon, no date. Same fav-item/fav-info/
              fav-text shell the Favourites list already uses (icon chip +
              title + subtitle), so a report reads as a real record —
              what was flagged, why, when, and its current status — instead
              of one plain sentence. */}
          {!loading && view === 'reports' && data.map((r) => (
            <div key={r.id} className="fav-item">
              <span className="fav-info">
                <span className="fav-icon fav-icon--flag"><FlagIcon width={16} height={16} /></span>
                <span className="fav-text">
                  <span className="fav-title">{r.content_title}</span>
                  <span className="report-reason">{r.reason}</span>
                </span>
              </span>
              <span className="report-meta">
                <span className={`badge ${r.status === 'open' ? 'badge-pending' : 'badge-approved'}`}>{r.status}</span>
                <span className="report-date">{new Date(r.ts * 1000).toLocaleDateString()}</span>
              </span>
            </div>
          ))}

        </div>
      )}
      <ToastHost toast={toast} />
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
    const missing = firstMissingField([[name, "Child's name"]])
    if (missing) { setError(missing); return }
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
    // .panel alone is a scroll-container class (max-height/overflow, built
    // for the session-browser/favourites lists) — no flex or gap of its
    // own, so this form's fields fell back to bare block stacking, same
    // gap-less look the "My account" edit form had before. Reusing that
    // same fix's class here instead of inventing a near-duplicate one.
    <form className="panel account-edit-form" onSubmit={save} noValidate>
      <label>Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>Age band
        <Select value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
          <option value="5-8">5–8</option>
          <option value="9-12">9–12</option>
        </Select>
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
