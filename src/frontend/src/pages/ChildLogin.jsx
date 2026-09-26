import { useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { linkChild, pinLogin, getActivatedChildId, forgetDevice } from '../api'
import { firstMissingField } from '../formValidation'
import './child.css'

// CH01 (enter linking code, first time on this device) + CH02 (simplified
// PIN login on a device that's already activated — code isn't re-asked for).
export default function ChildLogin({ onLoggedIn }) {
  // Held in state, not re-read from localStorage on every render: "Not you?"
  // only clears localStorage, which never triggers a re-render on its own,
  // so the screen used to stay on the PIN-only form until a manual refresh.
  const [activatedChildId, setActivatedChildId] = useState(() => getActivatedChildId())
  return activatedChildId
    ? (
      <PinOnlyLogin
        childId={activatedChildId}
        onLoggedIn={onLoggedIn}
        onForget={() => { forgetDevice(); setActivatedChildId(null) }}
      />
    )
    : <FullLogin onLoggedIn={onLoggedIn} />
}

// CH02 — returning to a device this profile already activated.
function PinOnlyLogin({ childId, onLoggedIn, onForget }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const missing = firstMissingField([[pin, 'PIN']])
    if (missing) { setError(missing); return }
    setError(''); setBusy(true)
    try {
      const child = await pinLogin(childId, pin)
      onLoggedIn(child)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="child-login">
      <Avatar speaking={false} mood="happy" />
      <h1>Welcome back! 👋</h1>
      <p className="muted">Type your secret PIN (a grown-up can help!)</p>
      <form onSubmit={submit} noValidate>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="PIN"
          maxLength={6}
          inputMode="numeric"
          aria-label="PIN"
        />
        {error && <p className="error">{error}</p>}
        <button className="big-btn" type="submit" disabled={busy}>
          {busy ? 'One sec…' : "Let's go!"}
        </button>
      </form>
      <button className="linkbtn" style={{ marginTop: 12 }} onClick={onForget}>Not you? Use a different code</button>
      <Link className="home-link" to="/" style={{ marginTop: 16 }}>← Home</Link>
    </div>
  )
}

// CH01 — first time this device is being linked to a profile. loginId
// (alphanumeric, from the parent dashboard) and pin (numeric, the secret)
// are two genuinely different values as of 2026-09-09 — this step is
// usually parent-assisted, unlike the plain-PIN return login below.
function FullLogin({ onLoggedIn }) {
  const [loginId, setLoginId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const missing = firstMissingField([[loginId, 'Login ID'], [pin, 'PIN']])
    if (missing) { setError(missing); return }
    setError(''); setBusy(true)
    try {
      const child = await linkChild(loginId.trim(), pin)
      onLoggedIn(child)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="child-login">
      <Avatar speaking={false} mood="happy" />
      <h1>Hi! Let's start 🎉</h1>
      <p className="muted">Ask a grown-up for your Login ID and PIN from the parent dashboard.</p>
      <form onSubmit={submit} noValidate>
        <input
          value={loginId}
          onChange={(e) => setLoginId(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6))}
          placeholder="LOGIN ID"
          maxLength={6}
          autoCapitalize="characters"
          aria-label="Login ID"
        />
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="PIN"
          maxLength={6}
          inputMode="numeric"
          aria-label="PIN"
        />
        {error && <p className="error">{error}</p>}
        <button className="big-btn" type="submit" disabled={busy}>
          {busy ? 'One sec…' : "Let's go!"}
        </button>
      </form>
      <Link className="home-link" to="/" style={{ marginTop: 16 }}>← Home</Link>
    </div>
  )
}
