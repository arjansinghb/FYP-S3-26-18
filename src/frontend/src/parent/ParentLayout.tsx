// Shared chrome for every logged-in parent screen — deliberately plain/
// utilitarian (data-table-and-form energy), the opposite of the child app's
// playful theme. See agent-context/CLAUDE.md §2.2/§9: "distinct surfaces,
// different content/tone/permission levels, even where they share a backend."
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useParentSession } from '../state/useParentSession'
import * as parentApi from '../api/parentClient'
import NotificationBell from './NotificationBell'

interface Props {
  children: ReactNode
}

export default function ParentLayout({ children }: Props) {
  const { token, parent, logout } = useParentSession()
  const navigate = useNavigate()

  async function handleLogout() {
    if (token) {
      try {
        await parentApi.logout(token)
      } catch {
        // best-effort — still clear local state below regardless
      }
    }
    logout()
    navigate('/')
  }

  return (
    <div className="parent-shell">
      <header className="parent-topbar">
        <Link to="/dashboard" className="parent-brand">
          📚 StoryBuddy <span className="parent-brand-sub">for families</span>
        </Link>
        <nav className="parent-nav">
          <Link to="/dashboard">My Children</Link>
          <Link to="/account">Account</Link>
          {token && <NotificationBell token={token} />}
          {parent && <span className="parent-nav-email">{parent.email}</span>}
          <button className="parent-nav-logout" onClick={handleLogout}>
            Log out
          </button>
        </nav>
      </header>
      <main className="parent-content">{children}</main>
    </div>
  )
}
