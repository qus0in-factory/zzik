import { USAGE_PROVIDER_META } from '@domain/usage/providers'
import type { UsageProvider } from '@domain/usage/providers'
import { formatAge } from '@domain/usage/staleness'
import type { UsageCollectionStatus } from './load-usage'
import { t } from '@shared/messages'

/**
 * 상태 줄과 안내 문구(app에서 계산해 ui에 넘긴다 — ui는 판정하지 않는다).
 * 절대 시각은 브라우저 시간대 HH:MM, 상대 표기는 domain의 formatAge를 쓴다.
 */

function timeText(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** `마지막 수집 11:58 (2분 전)` — lastSuccessAt이 없으면 null. */
export function composeLastSuccessText(iso: string | null, nowIso: string | null): string | null {
  if (iso === null) return null
  return t('text.lastCollected', { time: timeText(iso), age: formatAge(iso, new Date(nowIso ?? iso)) })
}

/** `마지막 성공 2분 전` — stale 안내 문구. */
export function composeStaleNoteText(iso: string | null, nowIso: string | null): string | null {
  if (iso === null) return null
  return t('text.lastSuccess', { age: formatAge(iso, new Date(nowIso ?? iso)) })
}

/** 안내에 쓰는 봉투 필드(봉투 전체를 넘기지 않아도 되게 최소만 받는다). */
export interface CollectionNoteMeta {
  httpStatus: number | null
  retryAt: string | null
}

/**
 * 수집 상태별 안내 문구(ADR 0.3 v2 D4의 안내 표, D8).
 * - 인증 문제 세 가지(`token_expired`/`auth_required`/`auth_rejected`)를 구분한다.
 * - `upstream_error`는 마지막 상태 코드를 붙이고, 403이면 앞단 차단으로 안내한다(진단 본문은 로그에만).
 * - 갱신 클라이언트 이름만 제공자별로 바뀐다.
 * - 정상(`ok`)이거나 봉투가 없으면(목 데이터) null.
 */
export function composeCollectionNote(
  provider: UsageProvider,
  status: UsageCollectionStatus | null,
  meta: CollectionNoteMeta | null,
): string | null {
  if (status === null || status === 'ok') return null
  const client = USAGE_PROVIDER_META[provider].clientName

  switch (status) {
    case 'token_expired':
      return t('note.tokenExpired', { client })
    case 'auth_rejected':
      return t('note.authRejected', { client })
    case 'auth_required':
      return t('note.authRequired', { client })
    case 'no_credentials':
      return t('note.noCredentials', { client })
    case 'rate_limited':
      return meta?.retryAt
        ? t('note.rateLimited.at', { time: timeText(meta.retryAt) })
        : t('note.rateLimited.next')
    case 'upstream_error':
      if (meta?.httpStatus === 403) {
        return t('note.upstream.blocked')
      }
      return meta?.httpStatus === null || meta?.httpStatus === undefined
        ? t('note.upstream.noStatus')
        : t('note.upstream.status', { status: meta.httpStatus })
    case 'network_error':
      return USAGE_PROVIDER_META[provider].networkErrorNote ?? t('note.network')
    case 'collector_down':
      return t('note.collectorDown')
    case 'stale':
      return t('note.stale')
    default:
      return null
  }
}
