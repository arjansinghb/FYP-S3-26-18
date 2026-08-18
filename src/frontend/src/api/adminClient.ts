// System Admin (SA03-SA11) API calls — see src/backend/app/routers/admin.py.
// All require the "admin" role — a moderator token gets 403.
import { request } from './http'
import type { AdminUserSummary, IntegrationStatus, SystemHealth, SystemSettings } from '../types'

export function searchUsers(token: string, q?: string): Promise<AdminUserSummary[]> {
  return request(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token })
}

export function getUserDetail(token: string, parentId: string): Promise<{ parent: AdminUserSummary; children: unknown[] }> {
  return request(`/admin/users/${parentId}`, { token })
}

export function suspendUser(token: string, parentId: string): Promise<AdminUserSummary> {
  return request(`/admin/users/${parentId}/suspend`, { method: 'POST', token })
}

export function unsuspendUser(token: string, parentId: string): Promise<AdminUserSummary> {
  return request(`/admin/users/${parentId}/unsuspend`, { method: 'POST', token })
}

export function resetUserPassword(token: string, parentId: string): Promise<{ message: string }> {
  return request(`/admin/users/${parentId}/reset-password`, { method: 'POST', token })
}

export function getSystemHealth(token: string): Promise<SystemHealth> {
  return request('/admin/system-health', { token })
}

export function getIntegrations(token: string): Promise<IntegrationStatus> {
  return request('/admin/integrations', { token })
}

// SA10/SA11/SA13 — Compliance & Data-Retention / System Settings / Billing
// System Configuration.
export function getSystemSettings(token: string): Promise<SystemSettings> {
  return request('/admin/system-settings', { token })
}

export function updateSystemSettings(token: string, data: SystemSettings): Promise<SystemSettings> {
  return request('/admin/system-settings', { method: 'PATCH', token, body: data })
}
