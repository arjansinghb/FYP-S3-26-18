// PA20 — Receive Notifications. Lives in the topbar (ParentLayout) so it's
// visible from every logged-in parent screen. Pull model: polls on an
// interval rather than a push subscription — see
// src/backend/app/models/notification.py for why there's no real-time
// transport in this build.
import { useEffect, useRef, useState } from 'react'
import * as parentApi from '../api/parentClient'
import type { AppNotification } from '../types'

const POLL_INTERVAL_MS = 30_000

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function NotificationBell({ token }: { token: string }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  async function load() {
    try {
      setNotifications(await parentApi.listNotifications(token))
    } catch {
      // best-effort — a failed poll shouldn't disturb the rest of the dashboard
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleOpen() {
    setOpen((o) => !o)
  }

  async function handleMarkRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)))
    try {
      await parentApi.markNotificationRead(token, id)
    } catch {
      load() // reconcile with the server if the optimistic update was wrong
    }
  }

  const unreadCount = notifications.filter((n) => !n.read_at).length

  return (
    <div className="notif-bell" ref={containerRef}>
      <button className="notif-bell-trigger" onClick={handleOpen} aria-label="Notifications">
        🔔
        {unreadCount > 0 && <span className="notif-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-header">Notifications</div>
          {notifications.length === 0 && <p className="notif-dropdown-empty">Nothing yet.</p>}
          <ul className="notif-list">
            {notifications.map((n) => (
              <li key={n.id} className={`notif-item ${n.read_at ? '' : 'notif-item--unread'}`}>
                <div className="notif-item-title">{n.title}</div>
                <div className="notif-item-body">{n.body}</div>
                <div className="notif-item-footer">
                  <span>{timeAgo(n.created_at)}</span>
                  {!n.read_at && (
                    <button className="notif-item-read" onClick={() => handleMarkRead(n.id)}>
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
