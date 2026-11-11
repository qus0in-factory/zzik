import { describe, it, expect } from 'vitest'
import { authorize } from '../../../../worker/app/access/authorize'
import { FakeVerifier } from '../../../fakes/worker-ports'
describe('Given an authorization use case', () => {
  it('When the header is missing Then it skips verification', async () => {
    const verifier = new FakeVerifier()
    expect(await authorize(null, verifier, 'owner@example.com')).toEqual({ ok: false, reason: 'missing' })
    expect(verifier.tokens).toEqual([])
  })
  it.each(['invalid', 'unavailable'] as const)('When verification is %s Then it preserves the failure', async (reason) => {
    expect(await authorize('jwt', new FakeVerifier({ ok: false, reason }), 'owner@example.com')).toEqual({ ok: false, reason })
  })
  it('When the email differs Then it is forbidden', async () => {
    expect(await authorize('jwt', new FakeVerifier(), 'other@example.com')).toEqual({ ok: false, reason: 'forbidden' })
  })
  it('When the signature and policy pass Then it allows access', async () => {
    expect(await authorize('jwt', new FakeVerifier(), 'owner@example.com')).toEqual({ ok: true })
  })
})
