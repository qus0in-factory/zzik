import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createZaiUsageClient } from '../../../../collector/infra/usage/zai-usage-client.mjs'

describe('Given a Z.AI Coding Plan credential', () => {
  it.each(['normal', 'limited', 'unknown-keys'])('When fetching a %s response Then sends the bearer key and preserves the payload', async (fixture) => {
    const bodyText = readFileSync(new URL(`../../../fixtures/zai-usage.${fixture}.json`, import.meta.url), 'utf8')
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(bodyText))
    const client = createZaiUsageClient({ fetchImpl })

    expect(await client.fetchUsage('synthetic-key')).toEqual({
      ok: true, bodyText, httpStatus: 200, retryAfterSec: null,
    })
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith('https://api.z.ai/api/monitor/usage/quota/limit', expect.objectContaining({
      method: 'GET',
      redirect: 'manual',
      headers: { Authorization: 'Bearer synthetic-key', Accept: 'application/json' },
    }))
  })
})
