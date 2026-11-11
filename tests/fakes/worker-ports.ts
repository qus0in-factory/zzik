import type { AccessTokenVerifier, Verification } from '../../worker/domain/access/verifier'
import type { SnapshotStore, StoreResult } from '../../worker/domain/usage/store'
export class FakeVerifier implements AccessTokenVerifier {
  tokens: string[] = []
  constructor(public result: Verification = { ok: true, claims: { email: 'owner@example.com' } }) {}
  async verify(token: string) { this.tokens.push(token); return this.result }
}
export class FakeStore implements SnapshotStore {
  reads = 0
  constructor(public result: StoreResult = { ok: true, value: null }) {}
  async read() { this.reads++; return this.result }
}
