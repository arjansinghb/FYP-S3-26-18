// UV06 — Verify Account (confirm step, real-Firebase path). Landing page for
// the emailed verification link's continueUrl (dev-session 2026-08-17, see
// backend's app/core/firebase.py send_email_verification_email) — reads the
// `oobCode` Identity Toolkit appended to the link and confirms it
// automatically on mount. If the parent is still logged in on this device,
// their stored session is updated in place; either way they land on
// /account next.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/http'
import * as parentApi from '../api/parentClient'
import { useParentSession } from '../state/useParentSession'

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const oobCode = params.get('oobCode')
  const { isLoggedIn, updateParent } = useParentSession()
  const [status, setStatus] = useState<'checking' | 'done' | 'error'>('checking')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!oobCode) {
      setStatus('error')
      setError('No verification code found in this link.')
      return
    }
    parentApi
      .confirmEmailVerificationOob(oobCode)
      .then((parent) => {
        if (isLoggedIn) updateParent(parent)
        setStatus('done')
      })
      .catch((err) => {
        setStatus('error')
        setError(err instanceof ApiError ? err.message : 'That link is invalid or expired.')
      })
    // Only ever run once per landing, regardless of session-object identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oobCode])

  return (
    <div className="auth-screen">
      <Link to="/" className="landing-brand">📚 StoryBuddy</Link>
      <h1>Verify your email</h1>
      <div className="auth-card">
        {status === 'checking' && <p className="dashboard-note">Confirming…</p>}
        {status === 'done' && <p className="dashboard-note">Your email is verified.</p>}
        {status === 'error' && <p className="error-text">{error}</p>}
        <Link to={isLoggedIn ? '/account' : '/login'} className="big-button" style={{ display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}>
          {isLoggedIn ? 'Go to account' : 'Log in'}
        </Link>
      </div>
    </div>
  )
}
