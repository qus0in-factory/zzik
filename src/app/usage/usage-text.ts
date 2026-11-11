import { USAGE_PROVIDER_META } from '@domain/usage/providers'
import type { UsageProvider } from '@domain/usage/providers'
import { formatAge } from '@domain/usage/staleness'
import type { UsageCollectionStatus } from './load-usage'

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
  return `마지막 수집 ${timeText(iso)} (${formatAge(iso, new Date(nowIso ?? iso))})`
}

/** `마지막 성공 2분 전` — stale 안내 문구. */
export function composeStaleNoteText(iso: string | null, nowIso: string | null): string | null {
  if (iso === null) return null
  return `마지막 성공 ${formatAge(iso, new Date(nowIso ?? iso))}`
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
      return `${client}를 실행하면 갱신됩니다.`
    case 'auth_rejected':
      return `토큰은 만료 전인데 서버가 인증을 거부했습니다. ${client}를 실행해 보고, 그대로면 다시 로그인하세요. 수집기 로그의 상태 코드를 확인하세요.`
    case 'auth_required':
      return `인증 상태를 확인할 수 없습니다. ${client}를 실행해 보세요.`
    case 'no_credentials':
      return `자격 증명을 찾지 못했습니다. ${client} 로그인 상태를 확인하세요.`
    case 'rate_limited':
      return meta?.retryAt
        ? `요청이 제한되었습니다. ${timeText(meta.retryAt)} 이후 자동으로 다시 시도합니다.`
        : '요청이 제한되었습니다. 다음 주기에 자동으로 다시 시도합니다.'
    case 'upstream_error':
      if (meta?.httpStatus === 403) {
        return '앞단에서 응답이 차단되었습니다(HTTP 403). 우회하지 말고 잠시 뒤 다시 확인하세요.'
      }
      return meta?.httpStatus === null || meta?.httpStatus === undefined
        ? '수집 중 오류가 발생했습니다. 다음 주기에 다시 시도합니다.'
        : `수집 중 오류가 발생했습니다(HTTP ${meta.httpStatus}). 다음 주기에 다시 시도합니다.`
    case 'network_error':
      return '네트워크 오류로 수집하지 못했습니다. 다음 주기에 다시 시도합니다.'
    case 'collector_down':
      return '수집기가 응답하지 않습니다. Mac 절전 또는 프로세스 종료일 수 있습니다.'
    case 'stale':
      return '마지막 성공 값이 오래되었습니다. 수집기가 다음 값을 쓸 때까지 기다려 주세요.'
    default:
      return null
  }
}
