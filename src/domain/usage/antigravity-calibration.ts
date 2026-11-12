import { rebaseIsoFields } from './rebase-iso-fields'

/** DEV-only date rebasing, preserving the original masked/synthetic data. */
export function rebaseAntigravityResetsAt(raw: Record<string, unknown>, from: Date, to: Date): Record<string, unknown> {
  return rebaseIsoFields(raw, ['resetTime'], from, to)
}
