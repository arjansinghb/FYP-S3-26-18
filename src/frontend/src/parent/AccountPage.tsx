// PA04 (View Account Details) / PA05 (Update Account Details) / PA06 (Delete
// Account) / UV06 (Verify Account) / PA22 (Notification Preferences) / PA29
// (Data Privacy Settings) / PA23-27 (Premium billing, simulated).
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/http'
import * as parentApi from '../api/parentClient'
import ParentLayout from './ParentLayout'
import Toggle from './Toggle'
import { useParentSession } from '../state/useParentSession'
import { subscribeToPush, unsubscribeFromPush } from '../state/pushNotifications'
import type { BillingRecord, Parent } from '../types'

export default function AccountPage() {
  const { token, parent, updateParent, logout } = useParentSession()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState(parent?.display_name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (!parent || !token) return null

  async function handleSave() {
    if (!token) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const updated = await parentApi.updateAccount(token, { display_name: displayName })
      updateParent(updated)
      setNotice('Saved.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!token) return
    if (!window.confirm('Delete your account and ALL child profiles/data under it? This cannot be undone.')) return
    setBusy(true)
    try {
      await parentApi.deleteAccount(token)
      logout()
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete account.')
      setBusy(false)
    }
  }

  return (
    <ParentLayout>
      <h1>Account</h1>

      <EmailVerificationBanner token={token} emailVerified={parent.email_verified} onVerified={updateParent} />

      <section className="dashboard-section">
        <div className="inline-form">
          <label>
            Email
            <input value={parent.email} disabled />
          </label>
          <label>
            Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            Subscription tier
            <input value={parent.subscription_tier} disabled />
          </label>
          {notice && <p className="notice-text">{notice}</p>}
          {error && <p className="error-text">{error}</p>}
          <button className="big-button" onClick={handleSave} disabled={busy}>
            Save
          </button>
        </div>
      </section>

      <BillingSection token={token} />

      <section className="dashboard-section">
        <h2>Notification preferences — PA22</h2>
        <p className="dashboard-note">Event types</p>
        <Toggle
          label="Flag resolved"
          hint="Notify me when a moderator resolves content I've reported."
          checked={parent.notification_preferences.flag_resolved}
          onChange={(checked) =>
            parentApi
              .updateNotificationPreferences(token, { ...parent.notification_preferences, flag_resolved: checked })
              .then((prefs) => updateParent({ ...parent, notification_preferences: prefs }))
          }
        />
        <Toggle
          label="Child activated"
          hint="Notify me the first time a child profile logs in on a new device."
          checked={parent.notification_preferences.child_activated}
          onChange={(checked) =>
            parentApi
              .updateNotificationPreferences(token, { ...parent.notification_preferences, child_activated: checked })
              .then((prefs) => updateParent({ ...parent, notification_preferences: prefs }))
          }
        />

        <p className="dashboard-note" style={{ marginTop: 'var(--space-5)' }}>Channels</p>
        <Toggle
          label="In-app"
          hint="The bell icon in the topbar. The only channel actually wired up right now."
          checked={parent.notification_preferences.channels.in_app}
          onChange={(checked) =>
            parentApi
              .updateNotificationPreferences(token, {
                ...parent.notification_preferences,
                channels: { ...parent.notification_preferences.channels, in_app: checked },
              })
              .then((prefs) => updateParent({ ...parent, notification_preferences: prefs }))
          }
        />
        <Toggle
          label="Email"
          hint="No email service is configured in this build — turning this on is saved but nothing is actually sent."
          checked={parent.notification_preferences.channels.email}
          onChange={(checked) =>
            parentApi
              .updateNotificationPreferences(token, {
                ...parent.notification_preferences,
                channels: { ...parent.notification_preferences.channels, email: checked },
              })
              .then((prefs) => updateParent({ ...parent, notification_preferences: prefs }))
          }
        />
        <Toggle
          label="Push"
          hint="Real browser push (dev-session 2026-08-17) — needs this browser's notification permission, and only works in a production build (npm run build && npm run preview), not the plain dev server."
          checked={parent.notification_preferences.channels.push}
          onChange={async (checked) => {
            if (checked) {
              const ok = await subscribeToPush(token)
              if (!ok) {
                setError('Could not enable push — check that notifications are allowed for this site.')
                return
              }
            } else {
              await unsubscribeFromPush(token)
            }
            const prefs = await parentApi.updateNotificationPreferences(token, {
              ...parent.notification_preferences,
              channels: { ...parent.notification_preferences.channels, push: checked },
            })
            updateParent({ ...parent, notification_preferences: prefs })
          }}
        />
      </section>

      <section className="dashboard-section">
        <h2>Data privacy — PA29</h2>
        <div className="inline-form">
          <label>
            Data retention preference
            <select
              value={parent.data_privacy_settings.retention_preference}
              onChange={(e) =>
                parentApi
                  .updatePrivacySettings(token, { retention_preference: e.target.value })
                  .then((settings) => updateParent({ ...parent, data_privacy_settings: settings }))
              }
            >
              <option value="standard">Standard — keep activity history as normal</option>
              <option value="minimal">Minimal — keep only what's needed to run the account</option>
            </select>
          </label>
        </div>
      </section>

      <section className="dashboard-section dashboard-section--danger">
        <h2>Danger zone</h2>
        <button className="danger-button" onClick={handleDelete} disabled={busy}>
          Delete account (PA06)
        </button>
      </section>
    </ParentLayout>
  )
}

// UV06 — Verify Account. dev-session 2026-08-17: firebase_configured now
// sends a real email (see backend's app/core/firebase.py
// send_email_verification_email) — the emailed link lands on
// VerifyEmailPage.tsx, which confirms automatically and updates this same
// stored session. Local-dev-store still has no email transport, so that
// path keeps the inline "here's the link" shortcut, unchanged.
function EmailVerificationBanner({
  token,
  emailVerified,
  onVerified,
}: {
  token: string
  emailVerified: boolean
  onVerified: (parent: Parent) => void
}) {
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (emailVerified) return null

  async function handleRequest() {
    setBusy(true)
    setError(null)
    try {
      const { verification_token } = await parentApi.requestEmailVerification(token)
      // dev-session 2026-08-17: null means a real email was actually sent
      // (see backend docstring) — nothing left to display/confirm inline.
      if (verification_token) {
        setPendingToken(verification_token)
      } else {
        setEmailSent(true)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send a verification link.')
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm() {
    if (!pendingToken) return
    setBusy(true)
    setError(null)
    try {
      const parent = await parentApi.confirmEmailVerification(pendingToken)
      onVerified(parent)
      setPendingToken(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That link is invalid or expired.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dashboard-section dashboard-section--warning">
      <h2>Verify your email — UV06</h2>
      {!pendingToken && !emailSent && (
        <>
          <p className="dashboard-note">Your email address isn't verified yet.</p>
          {error && <p className="error-text">{error}</p>}
          <button className="big-button" onClick={handleRequest} disabled={busy}>
            Send verification link
          </button>
        </>
      )}
      {emailSent && (
        <p className="dashboard-note">
          Verification email sent — open it on this device to finish verifying.
        </p>
      )}
      {pendingToken && (
        <>
          <p className="dashboard-note">
            This build has no email service configured, so instead of an emailed link, here's the link that would
            have been sent:
          </p>
          <div className="inline-form">
            <code className="verification-link-preview">{pendingToken}</code>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="big-button" onClick={handleConfirm} disabled={busy}>
            Confirm — I clicked the link
          </button>
        </>
      )}
    </section>
  )
}

// PA23-27 — Premium billing (simulated). PA23 (View Subscription Status) is
// just parent.subscription_tier, shown in the section above — this section
// is the rest: payment method, subscribe/cancel, billing history.
function BillingSection({ token }: { token: string }) {
  const { parent, updateParent } = useParentSession()
  const [history, setHistory] = useState<BillingRecord[] | null>(null)
  const [cardNumber, setCardNumber] = useState('')
  const [expMonth, setExpMonth] = useState('')
  const [expYear, setExpYear] = useState('')
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    parentApi.getBillingHistory(token).then(setHistory).catch(() => setHistory([]))
  }, [token])

  if (!parent) return null

  async function handleSavePaymentMethod(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const method = await parentApi.updatePaymentMethod(token, {
        card_number: cardNumber,
        exp_month: Number(expMonth),
        exp_year: Number(expYear),
      })
      updateParent({ ...parent!, payment_method: method })
      setCardNumber('')
      setNotice('Payment method saved.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save payment method.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSubscribe() {
    setBusy(true)
    setError(null)
    try {
      const updated = await parentApi.subscribeToPremium(token, billingCycle)
      updateParent(updated)
      setHistory(await parentApi.getBillingHistory(token))
      setNotice('Welcome to Premium!')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not subscribe.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    if (!window.confirm('Cancel your Premium subscription? You\'ll keep access until the end of the current billing period.')) return
    setBusy(true)
    setError(null)
    try {
      const updated = await parentApi.cancelPremium(token)
      updateParent(updated)
      setHistory(await parentApi.getBillingHistory(token))
      setNotice('Cancellation scheduled — Premium stays active until then.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel.')
    } finally {
      setBusy(false)
    }
  }

  async function handleResume() {
    setBusy(true)
    setError(null)
    try {
      const updated = await parentApi.resumePremium(token)
      updateParent(updated)
      setHistory(await parentApi.getBillingHistory(token))
      setNotice('Cancellation undone — staying on Premium.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resume.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dashboard-section">
      <h2>Billing — PA24-27 (simulated)</h2>
      <p className="dashboard-note">
        No real payment processor is wired into this build — nothing here is ever actually charged. Good for
        demoing the flow, not for taking real money.
      </p>

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="notice-text">{notice}</p>}

      <div className="inline-form">
        <label>
          Payment method on file
          <input
            value={parent.payment_method ? `${parent.payment_method.brand} •••• ${parent.payment_method.last4}` : 'None'}
            disabled
          />
        </label>
      </div>

      <form className="inline-form" onSubmit={handleSavePaymentMethod}>
        <label>
          Card number
          <input
            inputMode="numeric"
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, ''))}
            placeholder="4242 4242 4242 4242"
            minLength={12}
            maxLength={19}
            required
          />
        </label>
        <label>
          Exp. month
          <input
            inputMode="numeric"
            value={expMonth}
            onChange={(e) => setExpMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="MM"
            required
          />
        </label>
        <label>
          Exp. year
          <input
            inputMode="numeric"
            value={expYear}
            onChange={(e) => setExpYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="YYYY"
            required
          />
        </label>
        <button className="big-button" type="submit" disabled={busy}>
          {parent.payment_method ? 'Update card' : 'Add card'}
        </button>
      </form>

      {parent.subscription_tier === 'free' ? (
        <>
          <div className="inline-form">
            <label>
              Billing cycle
              <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value as 'monthly' | 'annual')}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual (2 months free)</option>
              </select>
            </label>
          </div>
          <button className="big-button" onClick={handleSubscribe} disabled={busy || !parent.payment_method}>
            Subscribe to Premium
          </button>
        </>
      ) : parent.subscription_cancel_at ? (
        <div className="premium-lock">
          <p>
            Premium cancelled — you'll keep access until{' '}
            <strong>{new Date(parent.subscription_cancel_at).toLocaleDateString()}</strong>.
          </p>
          <button className="big-button" onClick={handleResume} disabled={busy}>
            Stay on Premium
          </button>
        </div>
      ) : (
        <button className="danger-button" onClick={handleCancel} disabled={busy}>
          Cancel Premium ({parent.subscription_billing_cycle ?? 'monthly'})
        </button>
      )}

      <h2 className="billing-history-heading">Billing history — PA27</h2>
      {history === null && <p>Loading…</p>}
      {history !== null && history.length === 0 && <p className="dashboard-empty">No billing activity yet.</p>}
      {history !== null && history.length > 0 && (
        <table className="staff-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Event</th>
              <th>Amount</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {history.map((record) => (
              <tr key={record.id}>
                <td>{new Date(record.created_at).toLocaleDateString()}</td>
                <td>
                  <span className={`status-badge status-badge--${record.event === 'subscribed' ? 'success' : 'neutral'}`}>
                    {record.event}
                  </span>
                </td>
                <td>${(record.amount_cents / 100).toFixed(2)}</td>
                <td>{record.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
