export interface Env {
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  ALLOWED_EMAIL?: string
  DB_URL?: string
  USAGE_KV: { get(key: string): Promise<string | null> }
  ASSETS: { fetch(request: Request): Promise<Response> }
}
