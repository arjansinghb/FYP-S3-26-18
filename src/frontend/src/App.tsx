// Top-level router. Three separate app trees, per agent-context/CLAUDE.md
// §2.2/§9's "distinct surfaces" rule:
//   /chat              -> ChildApp (playful, chat-first)
//   /moderation, /admin -> staff console (moderator + admin, shared login)
//   everything else     -> parent-facing marketing/dashboard screens
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ChildApp from './ChildApp'
import AccountPage from './parent/AccountPage'
import ChildDetailPage from './parent/ChildDetailPage'
import ConsentPage from './parent/ConsentPage'
import DashboardHome from './parent/DashboardHome'
import LandingPage from './parent/LandingPage'
import LoginPage from './parent/LoginPage'
import RequireParentAuth from './parent/RequireParentAuth'
import ResetPasswordPage from './parent/ResetPasswordPage'
import SignupPage from './parent/SignupPage'
import VerifyEmailPage from './parent/VerifyEmailPage'
import AdminSystemPage from './staff/AdminSystemPage'
import AdminUsersPage from './staff/AdminUsersPage'
import CataloguePage from './staff/CataloguePage'
import FlaggedContentPage from './staff/FlaggedContentPage'
import RequireStaffAuth from './staff/RequireStaffAuth'
import ReviewQueuePage from './staff/ReviewQueuePage'
import SearchImportPage from './staff/SearchImportPage'
import StaffLoginPage from './staff/StaffLoginPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/chat" element={<ChildApp />} />

        <Route path="/" element={<LandingPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route
          path="/consent"
          element={
            <RequireParentAuth>
              <ConsentPage />
            </RequireParentAuth>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireParentAuth requireConsent>
              <DashboardHome />
            </RequireParentAuth>
          }
        />
        <Route
          path="/dashboard/children/:childId"
          element={
            <RequireParentAuth requireConsent>
              <ChildDetailPage />
            </RequireParentAuth>
          }
        />
        <Route
          path="/account"
          element={
            <RequireParentAuth>
              <AccountPage />
            </RequireParentAuth>
          }
        />

        <Route path="/staff/login" element={<StaffLoginPage />} />
        <Route
          path="/moderation"
          element={
            <RequireStaffAuth>
              <ReviewQueuePage />
            </RequireStaffAuth>
          }
        />
        <Route
          path="/moderation/search"
          element={
            <RequireStaffAuth>
              <SearchImportPage />
            </RequireStaffAuth>
          }
        />
        <Route
          path="/moderation/catalogue"
          element={
            <RequireStaffAuth>
              <CataloguePage />
            </RequireStaffAuth>
          }
        />
        <Route
          path="/moderation/flags"
          element={
            <RequireStaffAuth>
              <FlaggedContentPage />
            </RequireStaffAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireStaffAuth requireAdmin>
              <AdminSystemPage />
            </RequireStaffAuth>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireStaffAuth requireAdmin>
              <AdminUsersPage />
            </RequireStaffAuth>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
