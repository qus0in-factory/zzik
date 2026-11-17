import { describe, expect, it } from 'vitest'
import type { TrendSectionPayload, TrendSourceState } from '../../../../shared/trend-contract'
import {
  TREND_FREE_MODELS_RULE,
  TREND_SOURCE_OLLAMA_BLOG,
  TREND_SOURCE_OPENCODE_GO,
} from '../../../../shared/trend-contract'
import { buildFreeModels } from '../../../../worker/domain/trend/sections/free-models'
import { decodeGoModels, decodeOllamaBlogRss } from '../../../../worker/domain/trend/sources'
import type { TrendModelRecord } from '../../../../worker/domain/trend/sources'

const NOW = Date.UTC(2026, 10, 17, 5, 0, 0)
const DAY = 86_400_000

function goRecord(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'tencent/hy4-flash',
    provider: 'opencode-go',
    modelId: 'hy4-flash-free',
    name: 'Hy4 flash Free',
    creator: 'tencent',
    releaseDate: '2026-11-16',
    releasePrecision: 'day',
    releaseMs: NOW - DAY,
    price: { input: 0, output: 0 },
    free: true,
    openWeights: false,
    status: null,
    expiresAtMs: null,
    limitedTime: true,
    limitedRegions: false,
    link: 'https://opencode.ai/console/go#pricing',
    ...overrides,
  }
}

function ollamaRecord(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'ollama-blog:reflection-beam',
    provider: 'ollama-cloud',
    modelId: 'reflection-beam',
    name: "Reflection's Beam",
    creator: 'ollama',
    releaseDate: '2026-10-16',
    releasePrecision: 'day',
    releaseMs: NOW - 32 * DAY,
    price: { input: 0, output: 0 },
    free: true,
    openWeights: true,
    status: null,
    expiresAtMs: null,
    limitedTime: true,
    link: 'https://ollama.com/blog/reflection-beam',
    ...overrides,
  }
}

const okSources: TrendSourceState[] = [
  { id: TREND_SOURCE_OPENCODE_GO, fetchedAt: new Date(NOW).toISOString(), status: 'ok' },
  { id: TREND_SOURCE_OLLAMA_BLOG, fetchedAt: new Date(NOW).toISOString(), status: 'ok' },
]

function build(input: {
  goModels?: TrendModelRecord[] | null
  ollamaBlog?: TrendModelRecord[] | null
  catalog?: TrendModelRecord[] | null
  previous?: TrendSectionPayload | null
  sources?: TrendSourceState[]
}) {
  return buildFreeModels({
    goModels: input.goModels === undefined ? [] : input.goModels,
    ollamaBlog: input.ollamaBlog === undefined ? [] : input.ollamaBlog,
    catalog: input.catalog ?? null,
    previous: input.previous ?? null,
    sources: input.sources ?? okSources,
    nowMs: NOW,
  })
}

describe('Given OpenCode Go and Ollama Blog decoders', () => {
  it('When decoding Go API JSON Then extracts price-0 free models with limited_regions and limitedTime', () => {
    const decoded = decodeGoModels({
      object: 'list',
      data: [
        {
          id: 'beam-free',
          name: 'Beam Free',
          canonical_id: 'reflection/beam-1.0-501b-a23b',
          release_date: '2026-10-05',
          open_weights: true,
          cost: { text: { input: { price: 0 }, output: { price: 0 } } },
          go: { monthly_usage: null, limited_regions: true },
        },
        {
          id: 'paid-go',
          name: 'Paid Go',
          cost: { text: { input: { price: 1 }, output: { price: 2 } } },
          go: { monthly_usage: 100, limited_regions: false },
        },
      ],
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.filter((r) => r.free)).toEqual([
      expect.objectContaining({
        modelId: 'beam-free',
        name: 'Beam Free',
        free: true,
        limitedRegions: true,
        limitedTime: true,
        link: 'https://opencode.ai/console/go#pricing',
      }),
    ])
  })

  it('When decoding Ollama Blog RSS Then extracts limited-time free announcements with date and link', () => {
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel>
        <item>
          <title>Reflection&#39;s Beam is freely available on Ollama for a limited time</title>
          <link>https://ollama.com/blog/reflection-beam</link>
          <pubDate>Fri, 16 Oct 2026 00:00:00 +0000</pubDate>
          <description>Reflection's first open-weight model is now available on Ollama, and free for a limited time only.</description>
        </item>
        <item>
          <title>Clef is available on Ollama's cloud</title>
          <link>https://ollama.com/blog/clef</link>
          <pubDate>Mon, 19 Oct 2026 00:00:00 +0000</pubDate>
          <description>Clef, a 27B multimodal decision model from Cloudflare, is now available on Ollama.</description>
        </item>
      </channel></rss>`
    const decoded = decodeOllamaBlogRss(rss)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value).toHaveLength(1)
    expect(decoded.value[0]).toMatchObject({
      name: "Reflection's Beam is freely available on Ollama for a limited time",
      releaseDate: '2026-10-16',
      free: true,
      limitedTime: true,
      link: 'https://ollama.com/blog/reflection-beam',
    })
  })
})

describe('Given the OpenCode Go & Ollama Cloud free-models builder', () => {
  it('When Go free models and Ollama limited-time blog posts exist Then emits both groups with badges and links', () => {
    const payload = build({
      goModels: [
        goRecord(),
        goRecord({
          canonicalId: 'reflection/beam-1.0-501b-a23b',
          modelId: 'beam-free',
          name: 'Beam Free',
          releaseDate: '2026-10-05',
          releaseMs: NOW - 43 * DAY,
          limitedRegions: true,
        }),
        goRecord({ canonicalId: 'paid', modelId: 'paid', free: false, price: { input: 1, output: 2 } }),
      ],
      ollamaBlog: [
        ollamaRecord(),
        ollamaRecord({ canonicalId: 'old-promo', releaseDate: '2026-01-01', releaseMs: NOW - 200 * DAY }),
      ],
    })
    expect(payload.rule).toBe(TREND_FREE_MODELS_RULE)
    expect(payload.items).toHaveLength(3)
    expect(payload.items[0]).toMatchObject({
      id: 'tencent/hy4-flash',
      freeKind: 'opencode-go',
      limitedTime: true,
      limitedRegions: false,
      recentlyAdded: true,
      links: { opencode: 'https://opencode.ai/console/go#pricing' },
    })
    expect(payload.items[1]).toMatchObject({
      id: 'reflection/beam-1.0-501b-a23b',
      freeKind: 'opencode-go',
      limitedTime: true,
      limitedRegions: true,
      recentlyAdded: false,
    })
    expect(payload.items[2]).toMatchObject({
      id: 'ollama-blog:reflection-beam',
      freeKind: 'ollama-cloud',
      limitedTime: true,
      links: { ollama: 'https://ollama.com/blog/reflection-beam' },
    })
  })

  it('When one source fails (null) Then preserves that group from previous while refreshing the other', () => {
    const previous = build({ goModels: [goRecord()], ollamaBlog: [ollamaRecord()] })
    const payload = build({ goModels: null, ollamaBlog: [ollamaRecord()] , previous })
    expect(payload.items.map((i) => i.freeKind)).toEqual(['opencode-go', 'ollama-cloud'])
  })
})
