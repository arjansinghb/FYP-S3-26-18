// PA01 — Log In.
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/http'
import * as parentApi from '../api/parentClient'
import { useParentSession } from '../state/useParentSession'

export default function LoginPage() {
  const { login } = useParentSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await parentApi.login(email, password)
      login(result)
      navigate(result.parent.consent_record ? '/dashboard' : '/consent')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <Link to="/" className="landing-brand">📚 StoryBuddy</Link>
      <h1>Log in</h1>
      <div className="auth-card">
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="big-button" type="submit" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      </div>
      <p className="auth-switch">
        <Link to="/reset-password">Forgot password?</Link>
      </p>
      <p className="auth-switch">
        New here? <Link to="/signup">Create an account</Link>
      </p>
    </div>
  )
}
