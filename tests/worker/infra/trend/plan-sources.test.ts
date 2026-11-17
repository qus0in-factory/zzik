import { describe, expect, it } from 'vitest'
import { createOllamaTagsSource, createOpenCodeGoSource } from '../../../../worker/infra/trend/plan-sources'

describe('Given the Worker public plan sources', () => {
  it('When Go returns a model list Then decodes catalog observations and sends redirect:manual', async () => {
    let url = ''
    let redirect: RequestRedirect | undefined
    const result = await createOpenCodeGoSource({
      fetchImpl: async (input, init) => {
        url = String(input)
        redirect = init?.redirect
        return new Response(JSON.stringify({
          object: 'list',
          data: [{ id: 'deepseek-v4.1-flash', canonical_id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash 1017' }],
        }), { status: 200 })
      },
    }).fetch(0)
    expect(url).toBe('https://opencode.ai/inference/go/v1/models')
    expect(redirect).toBe('manual')
    expect(result).toMatchObject({ ok: true, observations: [{ plan: 'opencode-go', modelId: 'deepseek/deepseek-v4.1-flash-1017', confidence: 'catalog' }] })
  })

  it('When Ollama returns a tags list Then decodes catalog observations', async () => {
    let url = ''
    const result = await createOllamaTagsSource({
      fetchImpl: async (input) => {
        url = String(input)
        return new Response(JSON.stringify({ models: [{ name: 'glm-5.3', size: 0 }] }), { status: 200 })
      },
    }).fetch(0)
    expect(url).toBe('https://ollama.com/api/tags')
    expect(result).toMatchObject({ ok: true, observations: [{ plan: 'ollama-cloud', modelId: 'glm-5.3', source: 'ollama-tags' }] })
  })

  it('When a plan source returns 302 Then does not follow it to a second host', async () => {
    let calls = 0
    const result = await createOpenCodeGoSource({
      fetchImpl: async (_input, init) => {
        calls += 1
        expect(init?.redirect).toBe('manual')
        return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })
      },
    }).fetch(0)
    expect(calls).toBe(1)
    expect(result).toEqual({ ok: false, reason: 'http', httpStatus: 302 })
  })

  it('When a plan source collapses to a broken 200 Then returns invalid', async () => {
    expect(await createOpenCodeGoSource({ fetchImpl: async () => new Response('{"error":"x"}', { status: 200 }) }).fetch(0))
      .toEqual({ ok: false, reason: 'invalid', httpStatus: null })
    expect(await createOllamaTagsSource({ fetchImpl: async () => new Response('{}', { status: 200 }) }).fetch(0))
      .toEqual({ ok: false, reason: 'invalid', httpStatus: null })
  })
})
