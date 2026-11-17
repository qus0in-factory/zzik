import { describe, expect, it } from 'vitest'
import type ky from 'ky'
import payload from '../../../fixtures/trend/new-models.payload.json'
import { createHttpTrendGateway } from '../../../../src/infra/trend/http-trend-gateway'

function client(response: Response | (() => Promise<Response>)): typeof ky {
  return { get: async () => (typeof response === 'function' ? response() : response) } as unknown as typeof ky
}

describe('Given the public trend gateway', () => {
  it('When a 200 section arrives Then returns the contract payload', async () => {
    const gateway = createHttpTrendGateway(client(new Response(JSON.stringify(payload), { status: 200 })))
    const result = await gateway.fetchSection('new-models')
    expect(result).toMatchObject({ ok: true, value: { section: 'new-models' } })
  })

  it('When 503 not_ready arrives Then exposes a distinguishable empty state', async () => {
    const gateway = createHttpTrendGateway(client(new Response(JSON.stringify({ error: 'not_ready' }), { status: 503 })))
    expect(await gateway.fetchSection('new-models')).toEqual({ ok: false, reason: 'not_ready', message: 'not_ready' })
  })

  it('When 500 or invalid JSON arrives Then returns a safe api error', async () => {
    const server = createHttpTrendGateway(client(new Response(JSON.stringify({ error: 'server' }), { status: 500 })))
    expect(await server.fetchSection('new-models')).toEqual({ ok: false, reason: 'api_error', message: 'server' })
    const invalid = createHttpTrendGateway(client(new Response('not-json', { status: 200 })))
    expect(await invalid.fetchSection('new-models')).toEqual({ ok: false, reason: 'api_error', message: 'invalid_response' })
  })

  it('When the network throws Then returns network_error without raw text', async () => {
    const gateway = createHttpTrendGateway(client(async () => { throw new Error('secret') }))
    expect(await gateway.fetchSection('new-models')).toEqual({ ok: false, reason: 'network_error', message: null })
  })
})
