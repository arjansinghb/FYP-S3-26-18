import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useStaffSession } from '../state/useStaffSession'

interface Props {
  children: ReactNode
  requireAdmin?: boolean
}

export default function RequireStaffAuth({ children, requireAdmin = false }: Props) {
  const { isLoggedIn, staff } = useStaffSession()

  if (!isLoggedIn) {
    return <Navigate to="/staff/login" replace />
  }
  if (requireAdmin && staff?.role !== 'admin') {
    return <Navigate to="/moderation" replace />
  }
  return <>{children}</>
}
