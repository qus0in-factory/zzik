import { useEffect, type ReactNode } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import App from './App'
import { TrendPage } from './TrendPage'

/** Access가 /usage 로드 시점에 바로 챌린지를 걸도록 클라이언트 Navigate 대신 전체 내비게이션을 쓴다. */
const defaultNavigate = (url: string): void => window.location.replace(url)

/** `/`와 알 수 없는 경로는 쿼리·해시를 유지한 채 `/usage`로 전체 이동한다. */
export function RedirectToUsage({ navigate = defaultNavigate }: { navigate?: (url: string) => void }): ReactNode {
  const location = useLocation()
  useEffect(() => {
    navigate(`/usage${location.search}${location.hash}`)
  }, [location.search, location.hash, navigate])
  return null
}

export function AppRoutes({ navigate }: { navigate?: (url: string) => void } = {}): ReactNode {
  return (
    <Routes>
      <Route path="/usage" element={<App />} />
      <Route path="/trend" element={<TrendPage />} />
      <Route path="*" element={<RedirectToUsage navigate={navigate} />} />
    </Routes>
  )
}
