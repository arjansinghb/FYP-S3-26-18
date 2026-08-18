// PA03 — Reset Password. One route, two modes depending on whether a
// Firebase-emailed oobCode is present in the URL (dev-session 2026-08-17,
// see backend's app/core/firebase.py send_password_reset_email/
// confirm_password_reset): no `oobCode` param -> the "request a reset email"
// form; `?oobCode=...&mode=resetPassword` (Identity Toolkit's default query
// shape for its continueUrl deep link) -> the "set a new password" form that
// lands here after the parent clicks the emailed link.
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/http'
import * as parentApi from '../api/parentClient'

function RequestResetForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await parentApi.resetPassword(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again?')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <p className="dashboard-note">
        If <strong>{email}</strong> is registered, a reset link has just been emailed to it. Open it on this device
        to set a new password.
      </p>
    )
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </label>
      {error && <p className="error-text">{error}</p>}
      <button className="big-button" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  )
}

function SetNewPasswordForm({ oobCode }: { oobCode: string }) {
  const navigate = useNavigate()
  const [newPassword, setNewPassword] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await parentApi.confirmPasswordReset(oobCode, newPassword)
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That link is invalid or expired — request a new one.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <>
        <p className="dashboard-note">Your password has been reset.</p>
        <button className="big-button" onClick={() => navigate('/login')}>
          Log in
        </button>
      </>
    )
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        New password
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={6}
          required
          autoFocus
        />
      </label>
      {error && <p className="error-text">{error}</p>}
      <button className="big-button" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const oobCode = params.get('oobCode')

  return (
    <div className="auth-screen">
      <Link to="/" className="landing-brand">📚 StoryBuddy</Link>
      <h1>{oobCode ? 'Set a new password' : 'Reset your password'}</h1>
      <div className="auth-card">
        {oobCode ? <SetNewPasswordForm oobCode={oobCode} /> : <RequestResetForm />}
      </div>
      <p className="auth-switch">
        <Link to="/login">Back to log in</Link>
      </p>
    </div>
  )
}
