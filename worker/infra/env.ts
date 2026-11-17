import type { D1DatabaseLike } from './usage/d1-history-store'
import type { R2BucketLike } from './usage/r2-export-bucket'

export interface Env {
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  ALLOWED_EMAIL?: string
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** D1 binding for all reads, scheduled maintenance and restore. Missing binding fails closed. */
  DB?: D1DatabaseLike
  /** Private R2 binding for scheduled export. Optional until the approval deploy. */
  EXPORT_BUCKET?: R2BucketLike
  /** Operator-controlled export generation; absent means 0. */
  USAGE_DATA_GENERATION?: string
  /** Optional compatibility selector; only d1 is accepted. */
  USAGE_READ_STORE?: string
}
