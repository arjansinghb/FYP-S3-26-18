// SA08 (System Health) + SA09 (API Integrations, read-only view) + SA10/SA11
// (System Settings) + SA13 (Manage Billing System Configuration).
import { useEffect, useState } from 'react'
import * as adminApi from '../api/adminClient'
import StaffLayout from './StaffLayout'
import { useStaffSession } from '../state/useStaffSession'
import type { IntegrationStatus, SystemHealth, SystemSettings } from '../types'

// SA08 — humanise the raw seconds/ms the backend reports (app/core/metrics.py).
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatLatency(ms: number | null): string {
  return ms === null ? '—' : `${Math.round(ms)} ms`
}

export default function AdminSystemPage() {
  const { token } = useStaffSession()
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    Promise.all([adminApi.getSystemHealth(token), adminApi.getIntegrations(token)])
      .then(([h, i]) => {
        setHealth(h)
        setIntegrations(i)
      })
      .catch(() => setError('Could not load system status.'))
  }, [token])

  return (
    <StaffLayout>
      <h1>System — SA08/SA09/SA10/SA11/SA13</h1>
      {error && <p className="error-text">{error}</p>}

      <section className="dashboard-section">
        <h2>System health</h2>
        {!health && <p>Loading…</p>}
        {health && (
          <table className="staff-table">
            <tbody>
              <tr><td>Status</td><td>{health.status}</td></tr>
              <tr><td>Uptime</td><td>{formatUptime(health.uptime_seconds)}</td></tr>
              <tr>
                <td>Error rate (last {Math.round(health.window_seconds / 60)}m)</td>
                <td>
                  {(health.error_rate_window * 100).toFixed(1)}%
                  {' '}({health.error_count_window}/{health.request_count_window} requests)
                </td>
              </tr>
              <tr><td>Avg request latency</td><td>{formatLatency(health.avg_latency_ms)}</td></tr>
              <tr>
                <td>NLP/recommendation latency</td>
                <td>{formatLatency(health.nlp_avg_latency_ms)} ({health.nlp_sample_count_window} samples)</td>
              </tr>
              <tr><td>Catalogue items</td><td>{health.catalogue_item_count}</td></tr>
              <tr><td>Parent accounts</td><td>{health.parent_count}</td></tr>
              <tr><td>Child profiles</td><td>{health.child_profile_count}</td></tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="dashboard-section">
        <h2>API integrations (read-only — set via .env, see src/backend/README.md)</h2>
        {!integrations && <p>Loading…</p>}
        {integrations && (
          <table className="staff-table">
            <tbody>
              {Object.entries(integrations).map(([key, configured]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>
                    <span className={`status-badge ${configured ? 'status-badge--success' : 'status-badge--neutral'}`}>
                      {configured ? 'configured' : 'not configured'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {token && <SettingsSection token={token} />}
    </StaffLayout>
  )
}

function SettingsSection({ token }: { token: string }) {
  const [settings, setSettings] = useState<SystemSettings | null>(null)
  const [allowlistText, setAllowlistText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    adminApi
      .getSystemSettings(token)
      .then((s) => {
        setSettings(s)
        setAllowlistText(s.youtube_channel_allowlist.join('\n'))
      })
      .catch(() => setError('Could not load system settings.'))
  }

  useEffect(load, [token])

  async function handleSave() {
    if (!settings) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const updated = await adminApi.updateSystemSettings(token, {
        ...settings,
        youtube_channel_allowlist: allowlistText
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      })
      setSettings(updated)
      setNotice('Saved.')
    } catch {
      setError('Could not save settings.')
    } finally {
      setBusy(false)
    }
  }

  if (!settings) return <section className="dashboard-section"><h2>Settings — SA10/SA11/SA13</h2><p>Loading…</p></section>

  return (
    <section className="dashboard-section">
      <h2>Settings — SA10/SA11/SA13</h2>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="notice-text">{notice}</p>}

      <div className="inline-form">
        <label>
          Data retention (days) — SA10
          <input
            type="number"
            value={settings.data_retention_days}
            onChange={(e) => setSettings({ ...settings, data_retention_days: Number(e.target.value) })}
          />
        </label>
        <label>
          Age-band split (years) — SA11
          <input
            type="number"
            value={settings.default_age_band_threshold}
            onChange={(e) => setSettings({ ...settings, default_age_band_threshold: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="inline-form">
        <label>
          Premium monthly price (USD) — SA13
          <input
            type="number"
            step="0.01"
            value={(settings.premium_monthly_price_cents / 100).toFixed(2)}
            onChange={(e) => setSettings({ ...settings, premium_monthly_price_cents: Math.round(Number(e.target.value) * 100) })}
          />
        </label>
        <label>
          Premium annual price (USD) — SA13
          <input
            type="number"
            step="0.01"
            value={(settings.premium_annual_price_cents / 100).toFixed(2)}
            onChange={(e) => setSettings({ ...settings, premium_annual_price_cents: Math.round(Number(e.target.value) * 100) })}
          />
        </label>
      </div>

      <label className="dashboard-note" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
        YouTube channel allowlist — SA13 (one channel ID per line; empty = open search, see
        src/backend/app/services/content_source_service.py)
      </label>
      <textarea
        className="settings-textarea"
        rows={4}
        value={allowlistText}
        onChange={(e) => setAllowlistText(e.target.value)}
        placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
      />

      <div style={{ marginTop: 'var(--space-4)' }}>
        <button className="big-button" onClick={handleSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </section>
  )
}
