import { SettingsIcon } from '../icons'

// Shown in place of the parent and child screens while maintenance mode (SA11)
// is on. Admins and moderators never see it; they keep working.
export default function MaintenanceNotice({ info }) {
  const email = info?.support_email
  return (
    <main className="maintenance-screen">
      <div className="maintenance-card" role="status">
        <div className="maintenance-icon"><SettingsIcon width={28} height={28} /></div>
        <h1>Pip is taking a short break</h1>
        <p>We&rsquo;re making a few updates. Please try again in a little while.</p>
        {email && <p className="maintenance-help">Need help? <a href={`mailto:${email}`}>{email}</a></p>}
        <button type="button" onClick={() => window.location.reload()}>Try again</button>
      </div>
    </main>
  )
}
