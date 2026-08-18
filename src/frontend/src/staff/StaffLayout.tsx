// Shared chrome for moderator + admin consoles — plain data-table-and-form
// tooling, not subject to the "not a search engine" child-UI rule (staff-
// facing, not child-facing — see agent-context/CLAUDE.md §9).
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStaffSession } from '../state/useStaffSession'
import * as moderatorApi from '../api/moderatorClient'

interface Props {
  children: ReactNode
}

export default function StaffLayout({ children }: Props) {
  const { token, staff, logout } = useStaffSession()
  const navigate = useNavigate()

  async function handleLogout() {
    if (token) {
      try {
        await moderatorApi.logout(token)
      } catch {
        // best-effort
      }
    }
    logout()
    navigate('/staff/login')
  }

  return (
    <div className="parent-shell">
      <header className="parent-topbar">
        <Link to="/moderation" className="parent-brand">
          🛠️ StoryBuddy <span className="parent-brand-sub">staff console</span>
        </Link>
        <nav className="parent-nav">
          <Link to="/moderation">Review Queue</Link>
          <Link to="/moderation/search">Find Content</Link>
          <Link to="/moderation/catalogue">Catalogue</Link>
          <Link to="/moderation/flags">Flags</Link>
          {staff?.role === 'admin' && (
            <>
              <Link to="/admin">System</Link>
              <Link to="/admin/users">Users</Link>
            </>
          )}
          <span className="parent-nav-email">
            {staff?.email} ({staff?.role})
          </span>
          <button className="parent-nav-logout" onClick={handleLogout}>
            Log out
          </button>
        </nav>
      </header>
      <main className="parent-content">{children}</main>
    </div>
  )
}
