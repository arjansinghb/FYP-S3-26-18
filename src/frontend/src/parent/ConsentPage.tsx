// PA28 — Provide Verifiable Parental Consent. Gates PA07 (Create Child
// Profile) — see agent-context/CLAUDE.md §2.2 point 1. dev-session
// 2026-08-17: "verifiable" is now enforced, not just a click-through — the
// URS's own use-case description gives the example "re-authentication or
// payment-method verification"; this re-checks the parent's password
// server-side (see backend's ConsentRequest model) before recording consent.
// Billing stays simulated/untouched, so payment-method verification wasn't
// the option picked — see agent-context/CLAUDE.md §15.9.
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/http'
import * as parentApi from '../api/parentClient'
import { useParentSession } from '../state/useParentSession'

export default function ConsentPage() {
  const { token, updateParent, logout } = useParentSession()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleConfirm(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      await parentApi.provideConsent(token, password)
      const parent = await parentApi.getAccount(token)
      updateParent(parent)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again?')
    } finally {
      setBusy(false)
    }
  }

  function handleDecline() {
    // PRD alt-flow 2a: declining blocks child-profile creation — here that
    // just means staying logged in with no children, or logging out entirely.
    logout()
    navigate('/')
  }

  return (
    <div className="auth-screen">
      <h1>Before we set up your first child profile</h1>
      <div className="consent-box">
        <p>To protect your child's privacy, we need your explicit consent before collecting any data about them.</p>
        <p>Here's what that means:</p>
        <ul>
          <li>We'll store your child's name, birth year (to derive an age band), and a PIN you set.</li>
          <li>We'll log their chat messages and recommendations so you can review them.</li>
          <li>We never sell or use this data for advertising.</li>
          <li>You can request deletion of your child's data at any time from the dashboard.</li>
        </ul>
        <form onSubmit={handleConfirm}>
          <label>
            Re-enter your password to confirm it's really you (PDPA verifiable consent)
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="consent-actions">
            <button className="big-button" type="submit" disabled={busy}>
              {busy ? 'Confirming…' : 'I agree, continue'}
            </button>
            <button className="link-button" type="button" onClick={handleDecline}>
              Not right now
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
