import type { MouseEvent, ReactNode } from 'react'
import { t } from '@shared/messages'

/** 전체 페이지 이동(SPA 라우팅이 아니다). 같은 URL이어도 `assign`은 새로고침한다. */
const defaultNavigate = (url: string): void => window.location.assign(url)

/**
 * 헤더의 로고 + 제목 전체를 사이트 루트로 가는 링크로 만든다. 클릭하면 해시(#...)와 쿼리를 버리고 `/`로 전체 새로고침한다.
 * 일반 왼쪽 클릭만 가로채고, 수정 키(Ctrl·⌘·Shift·Alt)나 가운데 버튼은 브라우저 기본 동작(새 탭 등)에 맡긴다.
 */
export function HomeLink({ children, navigate = defaultNavigate }: { children: ReactNode; navigate?: (url: string) => void }): ReactNode {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate('/')
  }
  return (
    <a
      href="/"
      // 접근 이름은 링크 안의 제목 텍스트(h1 이름)다. '홈으로 이동'은 title(설명)로만 둔다 — aria-label로 덮으면 헤딩 이름이 바뀐다.
      title={t('action.home')}
      data-testid="home-link"
      onClick={onClick}
      className="flex items-center gap-3 rounded-md no-underline transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
    >
      {children}
    </a>
  )
}
