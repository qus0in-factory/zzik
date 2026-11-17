export function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } })
}

export interface PublicResponseOptions {
  status?: number
  maxAge?: number
  etag?: string
  noStore?: boolean
}

export function respondPublic(body: unknown, options: PublicResponseOptions = {}): Response {
  const status = options.status ?? 200
  const noStore = options.noStore ?? status >= 400
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': noStore ? 'no-store' : `public, max-age=${options.maxAge ?? 60}, stale-while-revalidate=300`,
    'X-Content-Type-Options': 'nosniff',
  }
  if (!noStore && options.etag) headers.ETag = options.etag
  return new Response(JSON.stringify(body), { status, headers })
}
