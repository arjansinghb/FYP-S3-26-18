// CM01/SA01 — Log In. Shared screen for both roles — no public signup (see
// src/backend/app/models/staff.py; accounts are created via
// scripts/create_staff.py).
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/http'
import * as moderatorApi from '../api/moderatorClient'
import { useStaffSession } from '../state/useStaffSession'

export default function StaffLoginPage() {
  const { login } = useStaffSession()
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
      const result = await moderatorApi.login(email, password)
      login(result)
      navigate('/moderation')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <h1>Staff login</h1>
      <p className="dashboard-note">Content Moderator / System Admin — accounts are provisioned by the team, not self-service.</p>
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
    </div>
  )
}
