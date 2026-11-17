import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import App from './App'
import { TrendPage } from './TrendPage'

/** `/`와 알 수 없는 경로는 쿼리를 유지한 채 `/usage`로 replace한다. */
function RedirectToUsage(): ReactNode {
  const location = useLocation()
  return <Navigate to={{ pathname: '/usage', search: location.search, hash: location.hash }} replace />
}

export function AppRoutes(): ReactNode {
  return (
    <Routes>
      <Route path="/usage" element={<App />} />
      <Route path="/trend" element={<TrendPage />} />
      <Route path="*" element={<RedirectToUsage />} />
    </Routes>
  )
}
