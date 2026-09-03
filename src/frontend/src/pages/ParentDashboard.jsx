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
  listNotifications, markNotificationRead,
  getSubscriptionStatus, subscribePremium, cancelPremium, resumePremium, getBillingHistory,
  setContentOverride, listContentOverrides, clearContentOverride, unlockChild,
  childReports, childTrends, compareChildren,
} from '../api'
import './parent.css'

export default function ParentDashboard() {
  const [account, setAccount] = useState(null)
  const [checking, setChecking] = useState(true)

  // Restore an existing session on load.
  useEffect(() => {
    if (!getToken()) { setChecking(false); return }
    getMe().then(setAccount).catch(() => {}).finally(() => setChecking(false))
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
          {note && <p className="muted">⚠️ {note}</p>}
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
          <p>✅ Password updated — you can sign in with your new password now.</p>
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
      <header className="parent-header">
        <div>
          <Link className="home-link" to="/">← Home</Link>
          <h1>Parent Dashboard</h1>
          <p className="muted">Signed in as {account.name} ({account.email})</p>
        </div>
        <div className="row">
          <NotificationsBell />
          <button className="ghost" onClick={onLogout}>Log out</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {!account.verified && <VerifyBanner account={account} onAccountUpdated={onAccountUpdated} />}

      <AccountPanel account={account} onUpdated={onAccountUpdated} onDeleted={onDeleted} />

      <SubscriptionPanel account={account} onAccountUpdated={onAccountUpdated} />

      <PrivacyPanel account={account} />

      <AddChild account={account} onAccountUpdated={onAccountUpdated} onAdded={reload} childCount={children.length} />

      <h2>Your children ({children.length})</h2>
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
    </div>
  )
}

// ---------- UV06 email verification ----------

function VerifyBanner({ account, onAccountUpdated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function verifyNow() {
    setBusy(true); setError('')
    try {
      // Dev mode: no email service exists, so the token comes back from the
      // API directly instead of being emailed — use the one from signup if
      // we still have it, otherwise request a fresh one.
      const token = account.verify_token || (await requestVerification()).token
      const updated = await confirmVerification(token)
      onAccountUpdated({ ...account, ...updated })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ background: '#fff8e8', borderColor: '#f0dca0' }}>
      <p><b>Please verify your email</b> — needed before you can add a child profile.</p>
      <p className="muted">Dev mode: no email service is configured yet, so verification happens with one click here instead of a real email link.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button onClick={verifyNow} disabled={busy}>{busy ? 'Verifying…' : 'Verify now'}</button>
      </div>
    </div>
  )
}

// ---------- PA20/22 notifications ----------

function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [loaded, setLoaded] = useState(false)

  async function toggle() {
    if (!open && !loaded) {
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
    <div style={{ position: 'relative' }}>
      <button className="ghost small" onClick={toggle}>
        🔔 {loaded && unread > 0 ? `(${unread})` : ''}
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: '110%', width: 320, zIndex: 10, maxHeight: 360, overflowY: 'auto' }}>
          <h3 style={{ margin: 0 }}>Notifications</h3>
          {items.length === 0 && <p className="muted">Nothing yet.</p>}
          {items.map((n) => (
            <div key={n.id} className="activity-item" style={{ cursor: 'pointer', opacity: n.read ? 0.6 : 1 }} onClick={() => read(n)}>
              <p className="said-child" style={{ margin: 0 }}>{n.read ? '' : '🔵 '}{n.title}</p>
              <p className="muted" style={{ margin: '2px 0' }}>{n.body}</p>
              <p className="ts">{new Date(n.created_at * 1000).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
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
          <p className="muted">Email: <b>{account.email}</b> {account.verified ? '✅ verified' : '⚠️ not verified'}</p>
          <p className="muted">Plan: <b>{account.tier === 'premium' ? 'Premium' : 'Free'}</b></p>
          <div className="row">
            <button className="danger small" onClick={remove}>Delete account</button>
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

function SubscriptionPanel({ account, onAccountUpdated }) {
  const [status, setStatus] = useState(null)
  const [history, setHistory] = useState([])
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [billingCycle, setBillingCycle] = useState('monthly')
  const [cardBrand, setCardBrand] = useState('Visa')
  const [cardLast4, setCardLast4] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function reload() {
    try { setStatus(await getSubscriptionStatus()) } catch { /* ignore */ }
  }
  useEffect(() => { reload() }, [account.tier])

  async function subscribe(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const payment_method = status?.payment_method || (cardLast4 ? { brand: cardBrand, last4: cardLast4 } : undefined)
      const s = await subscribePremium(billingCycle, payment_method)
      setStatus(s)
      onAccountUpdated({ ...account, tier: 'premium' })
      setShowUpgrade(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (!confirm('Cancel your Premium subscription? It stays active until the end of the current billing period.')) return
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

  if (!status) return null

  return (
    <section className="card">
      <div className="child-top">
        <h3>Subscription</h3>
        <span className={`badge ${status.tier === 'premium' ? 'badge-approved' : 'badge-pending'}`}>{status.tier}</span>
      </div>

      {status.tier === 'free' && (
        <>
          <p className="muted">Free plan: 1 child profile, 5 saved favourites per child, basic activity log.</p>
          {!showUpgrade
            ? <div className="row"><button onClick={() => setShowUpgrade(true)}>⭐ Upgrade to Premium</button></div>
            : (
              <form onSubmit={subscribe}>
                <label>Billing cycle
                  <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
                    <option value="monthly">Monthly — $9.99</option>
                    <option value="annual">Annual — $99.00</option>
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
                  <button type="submit" disabled={busy}>{busy ? 'Processing…' : 'Confirm subscription'}</button>
                  <button type="button" className="ghost" onClick={() => setShowUpgrade(false)}>Cancel</button>
                </div>
              </form>
            )}
        </>
      )}

      {status.tier === 'premium' && (
        <>
          <p className="muted">Up to 4 child profiles, unlimited favourites, full activity trends, multi-child comparison.</p>
          {status.payment_method && <p className="muted">Card on file: {status.payment_method.brand} •••• {status.payment_method.last4}</p>}
          {status.cancel_at
            ? (
              <>
                <p className="muted">⚠️ Cancels on {new Date(status.cancel_at * 1000).toLocaleDateString()} — you'll drop to Free after that.</p>
                <div className="row"><button className="ghost" onClick={resume}>Resume subscription</button></div>
              </>
            )
            : <div className="row"><button className="danger" onClick={cancel}>Cancel subscription</button></div>}
        </>
      )}

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
    <form onSubmit={submit} className="card" style={{ background: '#faf6ff' }}>
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
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await createChild({ name, age_band: ageBand, reading_level: readingLevel || null, pin })
      setName(''); setReadingLevel(''); setPin(''); setAgeBand('5-8'); setOpen(false)
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
        ➕ Add a child profile {childCount >= 1 && account.tier !== 'premium' ? '(Premium required for more than 1)' : ''}
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
      <label>PIN (exactly 6 digits — this is also the linking code your child enters the first time)
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} required pattern="\d{6}" title="Exactly 6 digits" minLength={6} maxLength={6} />
      </label>
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

function ChildCard({ child, account, onChanged }) {
  const [view, setView] = useState(null) // 'activity' | 'favourites' | 'edit' | 'safety' | 'reports' | 'insights' | 'privacy' | null
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [overrides, setOverrides] = useState({})

  async function toggle(which) {
    if (view === which) { setView(null); return }
    setView(which)
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

  return (
    <div className="child-card">
      <div className="child-top">
        <div>
          <h3>{child.name} {child.locked && <span className="badge badge-rejected">🔒 locked</span>}</h3>
          <p className="muted">Age {child.age_band}{child.reading_level ? ` · ${child.reading_level}` : ''}</p>
        </div>
        <button className="ghost small" onClick={remove}>Delete</button>
      </div>

      {child.locked && (
        <div className="card" style={{ background: '#fdeef4', margin: '10px 0' }}>
          <p className="muted">Too many wrong PIN attempts — {child.name} is locked out of the chat until you unlock it.</p>
          <div className="row"><button onClick={unlock}>Unlock profile</button></div>
        </div>
      )}

      <div className="linking">
        <span className="muted">Linking code / PIN (give to your child — it's the same 6-digit number):</span>
        <code className="code">{child.linking_code}</code>
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
      {view === 'privacy' && <ChildDataPrivacy child={child} onDone={() => setView(null)} />}

      {(view === 'activity' || view === 'favourites' || view === 'reports' || view === 'insights') && (
        <div className="panel">
          {loading && <p className="muted">Loading…</p>}
          {!loading && data.length === 0 && <p className="muted">Nothing here yet.</p>}

          {!loading && view === 'activity' && data.map((a, i) => (
            <div key={i} className="activity-item">
              <p className="said-child">🧒 {a.message}</p>
              <p className="said-pip">🤖 {a.reply}</p>
              <p className="ts">{new Date(a.ts * 1000).toLocaleString()}</p>
            </div>
          ))}

          {!loading && view === 'favourites' && data.map((f) => (
            <div key={f.id} className="fav-item">
              <span>{f.type === 'book' ? '📚' : '🎬'} {f.title}</span>
              <div className="row">
                {f.type === 'book' && <button className="ghost small" onClick={() => accessOptions(f)}>Access Options</button>}
                <button
                  className={`ghost small ${overrides[f.id] === 'approve' ? 'on' : ''}`}
                  onClick={() => override(f, overrides[f.id] === 'approve' ? undefined : 'approve')}
                  title="Always allow this item for this child, even outside their age band"
                >✅ Approve</button>
                <button
                  className={`ghost small ${overrides[f.id] === 'hide' ? 'on' : ''}`}
                  onClick={() => override(f, overrides[f.id] === 'hide' ? undefined : 'hide')}
                  title="Never recommend this item to this child"
                >🚫 Block</button>
                <button className="ghost small" onClick={() => report(f)}>Report</button>
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
              <p className="muted">{t.total_messages} messages · {t.total_recommendations} recommendations · {t.favourites_count} favourites</p>
              {t.total_messages < 3
                ? <p className="muted">Not enough activity yet to show trends — check back after a few more chats.</p>
                : <p>Top genres: <b>{t.top_genres.join(', ') || '—'}</b></p>}
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
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    const payload = { name, age_band: ageBand, reading_level: readingLevel || null }
    if (pin) payload.pin = pin
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
      <label>New PIN (leave blank to keep current — exactly 6 digits, also becomes the new linking code)
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} pattern="\d{6}" title="Exactly 6 digits" minLength={6} maxLength={6} />
      </label>
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
function ChildDataPrivacy({ child, onDone }) {
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
          <p className="muted">⏳ Deletion scheduled for {new Date(pending.scheduled_for * 1000).toLocaleDateString()}.</p>
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
