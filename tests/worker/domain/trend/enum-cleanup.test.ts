import { describe, expect, it } from 'vitest'
import { projectSectionPayload } from '../../../../worker/domain/trend/projection'

const base = {
  section: 'metrics', schemaVersion: 1, generatedAt: '2026-11-17T05:00:00.000Z', rule: 'x',
  sources: [], items: [],
}
const block = (extra: Record<string, unknown>) => ({
  id: 'or-usage', status: 'ok', asOf: '2026-11-17T04:00:00Z', entries: [], attribution: 'x', ...extra,
})

describe('Given the trimmed trend contract enums', () => {
  it.each(['under_review'])('When a block status is %s Then the projection rejects it', (status) => {
    expect(projectSectionPayload({ ...base, blocks: [block({ status })] }, 'metrics')).toBeNull()
  })

  it.each(['version_changed', 'terms_review'])('When a block note is %s Then the projection rejects it', (note) => {
    expect(projectSectionPayload({ ...base, blocks: [block({ note })] }, 'metrics')).toBeNull()
  })

  it('When a valid status and note are used Then the section still projects', () => {
    expect(projectSectionPayload({ ...base, blocks: [block({ note: 'source_failed' })] }, 'metrics')).not.toBeNull()
  })
})
