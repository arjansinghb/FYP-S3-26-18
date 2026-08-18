// UV05 — Sign Up (Create Parent Account).
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/http'
import * as parentApi from '../api/parentClient'
import { useParentSession } from '../state/useParentSession'

export default function SignupPage() {
  const { login } = useParentSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await parentApi.signup(email, password, displayName)
      login(result)
      navigate('/consent')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <Link to="/" className="landing-brand">📚 StoryBuddy</Link>
      <h1>Create your account</h1>
      <div className="auth-card">
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Your name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="big-button" type="submit" disabled={busy}>
            {busy ? 'Creating account…' : 'Sign up'}
          </button>
        </form>
      </div>
      <p className="auth-switch">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  )
}
