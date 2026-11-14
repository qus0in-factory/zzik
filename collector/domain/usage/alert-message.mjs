/** @typedef {import('./alert-types.mjs').AlertEvent} AlertEvent */
const DASHBOARD = 'https://zzik.qus0in.dev'
const PROVIDERS = /** @type {Record<string,string>} */ ({claude:'Claude',codex:'Codex',antigravity:'Antigravity',opencode:'OpenCode',grok:'Grok',ollama:'Ollama'})
const LEVELS = {previous_cycle:'이전 주기',new_cycle:'새 주기',normal:'정상',caution:'주의',danger:'위험',limit:'한도 도달'}
/** @param {number|null} value */
const percent = value => value === null ? '알 수 없음' : `${Math.round(value * 10) / 10}%`
/** @param {string|null} reset @param {number} nowMs */
function remaining(reset, nowMs) {
  if (reset === null || !Number.isFinite(Date.parse(reset))) return '리셋 시각 없음'
  const minutes = Math.max(0,Math.ceil((Date.parse(reset)-nowMs)/60_000))
  if (minutes === 0) return '리셋 시각 경과'
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60
  return `리셋 ${[days ? `${days}일` : '',hours ? `${hours}시간` : '',mins ? `${mins}분` : ''].filter(Boolean).join(' ')} 남음`
}
/** One Discord content, no raw payloads. @param {AlertEvent[]} events @returns {string} */
export function formatAlertMessage(events) {
  const heading = `사용량 알림 (${events.length}건)`
  const lines = []
  for (const event of events) {
    const name = (PROVIDERS[event.provider] ?? '제공자')
    const label = event.label.replace(/[\r\n]/g,' ').slice(0,100)
    const line = event.kind === 'spend' ? `[${name}] 추가 지출 한도 ${event.to === 'limit' ? '도달' : '해제'}` : `[${name}] ${label} · ${event.kind === 'reset' ? '주기 리셋 · ' : ''}${event.kind === 'reset' && event.previousLevel && event.previousLevel !== 'normal' ? `${LEVELS[event.previousLevel]} → ${LEVELS.normal}` : `${LEVELS[event.from]} → ${LEVELS[event.to]}`} · 사용 ${percent(event.usedPercent)} / 예상 ${percent(event.elapsedPercent)} · ${remaining(event.resetsAt,event.nowMs)}`
    if ([heading,...lines,line,DASHBOARD].join('\n').length > 1900) break
    lines.push(line)
  }
  if (lines.length < events.length) lines.push(`외 ${events.length-lines.length}건 생략 (대시보드 확인)`)
  return [heading,...lines,DASHBOARD].join('\n')
}

/** Safe dry-run rendering: neither raw labels nor usage/reset values are logged. @param {AlertEvent[]} events */
export function formatAlertPreview(events) {
  return events.length === 0 ? '[알림 없음]' : events.slice(0,10).map(event => event.kind === 'spend' ? `[${PROVIDERS[event.provider] ?? '제공자'}] 추가 지출 한도 ${event.to === 'limit' ? '도달' : '해제'}` : `[${PROVIDERS[event.provider] ?? '제공자'}] [한도 가림] · ${event.kind === 'reset' ? '주기 리셋 · ' : ''}${event.kind === 'reset' && event.previousLevel && event.previousLevel !== 'normal' ? `${LEVELS[event.previousLevel]} → ${LEVELS.normal}` : `${LEVELS[event.from]} → ${LEVELS[event.to]}`} · 사용/예상/리셋=[가림]`).join(' / ') + (events.length > 10 ? ' / 외 생략' : '')
}
