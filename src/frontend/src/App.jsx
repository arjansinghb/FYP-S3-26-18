import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import ChildChat from './pages/ChildChat'
import ParentDashboard from './pages/ParentDashboard'
import ModeratorDashboard from './pages/ModeratorDashboard'
import AdminDashboard from './pages/AdminDashboard'
import MaintenanceNotice from './components/MaintenanceNotice'
import { getMaintenanceStatus } from './api'

// Maintenance mode (SA11). While it is on, the parent and child screens are
// replaced by a friendly notice; the landing page and the staff consoles stay
// available, each with a slim reminder bar.
function MaintenanceGate({ children }) {
  const { pathname } = useLocation()
  const [info, setInfo] = useState(null)

  const check = useCallback(async () => {
    try { setInfo(await getMaintenanceStatus()) } catch { /* offline or backend down: leave as is */ }
  }, [])

  useEffect(() => {
    check()
    const timer = setInterval(check, 30000)
    // Any API call answered with 503 means maintenance just switched on.
    function onPaused(e) { setInfo({ active: true, message: e.detail.message, support_email: e.detail.supportEmail }) }
    window.addEventListener('pip-maintenance', onPaused)
    return () => { clearInterval(timer); window.removeEventListener('pip-maintenance', onPaused) }
  }, [check])

  const staffPage = pathname.startsWith('/admin') || pathname.startsWith('/moderator')
  const pausedPage = pathname.startsWith('/child') || pathname.startsWith('/parent')
  if (info?.active && pausedPage) return <MaintenanceNotice info={info} />

  return (
    <>
      {info?.active && staffPage && (
        <div className="maintenance-bar maintenance-bar--staff" role="status">
          Maintenance mode is on. Parents and children are paused; only admins and moderators can use Pip right now.
        </div>
      )}
      {info?.active && pathname === '/' && (
        <div className="maintenance-bar" role="status">Pip is being updated right now. Signing in is paused for a little while.</div>
      )}
      {children}
    </>
  )
}

// Top-level routing. The app has two sides:
//   /child  -> the voice avatar the child talks to
//   /parent -> the parent's account + oversight dashboard
export default function App() {
  return (
    <BrowserRouter>
      <MaintenanceGate>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/child" element={<ChildChat />} />
          <Route path="/parent/*" element={<ParentDashboard />} />
          <Route path="/moderator" element={<ModeratorDashboard />} />
          <Route path="/admin" element={<AdminDashboard />} />
        </Routes>
      </MaintenanceGate>
    </BrowserRouter>
  )
}
