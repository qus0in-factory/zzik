import { useMemo, type ReactNode } from 'react'
import { useAaTrendDeps } from '@app/trend/AaTrendContext'
import { providerMetaFor } from '@app/usage/provider-meta'
import { useProviderOrder } from '@app/usage/ProviderOrderContext'
import type { UsageProvider } from '@domain/usage/providers'
import { t } from '@shared/messages'
import { SectionNav } from '@ui/components/SectionNav'

export interface UsageSectionNavProps {
  /** 숨김 처리된 제공자 ID 목록(지정 시 내비게이션에서 제외). */
  hiddenProviders?: readonly UsageProvider[]
}

/** `/usage`용 헤더 아래 고정 섹션 이동 줄: 사용자 제공자 순서(숨김 제외) + 맨 끝 트렌드 패널. */
export function UsageSectionNav({ hiddenProviders = [] }: UsageSectionNavProps): ReactNode {
  const { order } = useProviderOrder()
  const aaTrendEnabled = useAaTrendDeps().enabled

  const sections = useMemo(() => {
    const hidden = new Set(hiddenProviders)
    const items = order
      .filter((provider) => !hidden.has(provider))
      .map((provider) => {
        const meta = providerMetaFor(provider)
        return { id: meta.sectionId, label: meta.title }
      })
    if (aaTrendEnabled) items.push({ id: 'trend', label: t('usage.trend.title') })
    return items
  }, [order, hiddenProviders, aaTrendEnabled])

  return <SectionNav pathname="/usage" ariaLabel={t('usage.sections.aria')} sections={sections} />
}
