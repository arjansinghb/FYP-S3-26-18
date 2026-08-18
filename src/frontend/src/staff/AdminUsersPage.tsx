// SA04 (Search User Account) + SA05 (View Details) + SA06/SA07
// (Suspend/Unsuspend) + SA03 (Reset User Password).
import { useEffect, useState } from 'react'
import { ApiError } from '../api/http'
import * as adminApi from '../api/adminClient'
import StaffLayout from './StaffLayout'
import { useStaffSession } from '../state/useStaffSession'
import type { AdminUserSummary } from '../types'

export default function AdminUsersPage() {
  const { token } = useStaffSession()
  const [q, setQ] = useState('')
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function refresh() {
    if (!token) return
    setUsers(await adminApi.searchUsers(token, q || undefined))
  }

  useEffect(() => {
    refresh().catch(() => setError('Could not load users.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function guarded(fn: () => Promise<void>) {
    setError(null)
    setNotice(null)
    try {
      await fn()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    }
  }

  return (
    <StaffLayout>
      <h1>Users — SA03/SA04/SA05/SA06/SA07</h1>
      <div className="inline-form">
        <label>
          Search by email or name
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && refresh()} />
        </label>
        <button className="big-button" onClick={refresh}>
          Search
        </button>
      </div>

      {notice && <p className="notice-text">{notice}</p>}
      {error && <p className="error-text">{error}</p>}

      <table className="staff-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Tier</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.display_name}</td>
              <td>{u.subscription_tier}</td>
              <td>
                <span className={`status-badge ${u.status === 'active' ? 'status-badge--success' : 'status-badge--danger'}`}>
                  {u.status}
                </span>
              </td>
              <td>
                <div className="table-btn-group">
                  {u.status === 'active' ? (
                    <button
                      className="table-btn table-btn--danger"
                      onClick={() => guarded(async () => void (await adminApi.suspendUser(token!, u.id)))}
                    >
                      Suspend
                    </button>
                  ) : (
                    <button
                      className="table-btn"
                      onClick={() => guarded(async () => void (await adminApi.unsuspendUser(token!, u.id)))}
                    >
                      Unsuspend
                    </button>
                  )}
                  <button
                    className="table-btn"
                    onClick={() =>
                      guarded(async () => {
                        const res = await adminApi.resetUserPassword(token!, u.id)
                        setNotice(res.message)
                      })
                    }
                  >
                    Reset password
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users.length === 0 && <p className="dashboard-empty">No users match.</p>}
    </StaffLayout>
  )
}
