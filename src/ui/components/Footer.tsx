import type { ReactNode } from 'react'
import { t } from '@shared/messages'
import { GithubMark } from './GithubMark'

export const GITHUB_REPO_URL = 'https://github.com/qus0in-factory/zzik'

/**
 * 화면 최하단 푸터: 왼쪽에 버전(vX.Y.Z), 오른쪽에 GitHub 저장소 링크.
 * 버전은 빌드 때 package.json에서 주입된다(`__APP_VERSION__`). 아래 여백(pb-16)은 우측 하단의 맨 위로 버튼과 겹치지 않게 비운다.
 */
export function Footer({ version = __APP_VERSION__ }: { version?: string }): ReactNode {
  return (
    <footer className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 pt-6 pb-16 text-xs text-muted-foreground sm:px-6 lg:px-8">
      <span data-testid="app-version" className="tabular-nums">
        {t('footer.version', { version })}
      </span>
      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('footer.repo')}
        title={t('footer.repo')}
        className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <GithubMark />
      </a>
    </footer>
  )
}
