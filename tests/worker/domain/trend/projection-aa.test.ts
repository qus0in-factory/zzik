import { describe, expect, it } from 'vitest'
import { projectSectionPayload } from '../../../../worker/domain/trend/projection'

const base = {
  section: 'metrics', schemaVersion: 1, generatedAt: '2026-11-17T05:00:00.000Z', rule: 'x',
  sources: [], items: [],
}

describe('Given the public projection of the AA citation', () => {
  it('When the payload has a complete sentence Then it is exposed as one string, not structured fields', () => {
    const projected = projectSectionPayload({
      ...base,
      aaCitation: 'Artificial Analysis Intelligence Index 1위는 Model A (90)입니다. (2026-11-17 기준)',
      blocks: [],
    }, 'metrics')
    expect(projected).not.toBeNull()
    expect((projected as { aaCitation?: unknown }).aaCitation).toBe('Artificial Analysis Intelligence Index 1위는 Model A (90)입니다. (2026-11-17 기준)')
  })

  it('When a legacy AA block carries scores and model ids Then the projection drops the whole block', () => {
    const projected = projectSectionPayload({
      ...base,
      blocks: [{
        id: 'aa-intelligence', status: 'ok', asOf: '2026-11-17', attribution: 'AA',
        entries: [{ id: 'model-a', name: 'Model A', creator: '', rank: 1, rankDelta: null, kind: 'steady', index: 90 }],
      }],
    }, 'metrics') as { blocks: unknown[]; aaCitation?: unknown }
    expect(projected.blocks).toEqual([])
    expect(projected.aaCitation).toBeUndefined()
    const json = JSON.stringify(projected)
    expect(json).not.toContain('model-a')
    expect(json).not.toContain('"index"')
    expect(json).not.toContain('"rank"')
    expect(json).not.toContain('90')
  })

  it('When aaCitation is an object or a list Then the projection rejects the payload', () => {
    for (const bad of [{ score: 90 }, ['Model A'], 90, '', 'x'.repeat(501)]) {
      expect(projectSectionPayload({ ...base, aaCitation: bad, blocks: [] }, 'metrics')).toBeNull()
    }
  })
})
