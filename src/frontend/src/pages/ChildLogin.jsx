import { useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { linkChild } from '../api'
import './child.css'

// CH01 (enter linking code) + CH02 (simplified PIN login).
export default function ChildLogin({ onLoggedIn }) {
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const child = await linkChild(code.trim().toUpperCase(), pin)
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
      <p className="muted">Type your code and secret PIN (a grown-up can help!)</p>
      <form onSubmit={submit}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="CODE"
          maxLength={6}
          aria-label="Linking code"
          required
        />
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="PIN"
          maxLength={6}
          inputMode="numeric"
          aria-label="PIN"
          required
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
