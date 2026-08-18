import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useParentSession } from '../state/useParentSession'

interface Props {
  children: ReactNode
  /** Redirect to /consent if the parent hasn't provided PA28 consent yet —
   * used on routes that assume at least one child profile might exist. */
  requireConsent?: boolean
}

export default function RequireParentAuth({ children, requireConsent = false }: Props) {
  const { isLoggedIn, parent } = useParentSession()

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />
  }
  if (requireConsent && parent && !parent.consent_record) {
    return <Navigate to="/consent" replace />
  }
  return <>{children}</>
}
