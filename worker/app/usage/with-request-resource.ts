export interface RequestResource {
  close(): Promise<void>
}
export interface RequestContext {
  waitUntil(promise: Promise<unknown>): void
}

/** Acquire only for API requests and release after the handler settles.
 * Drivers remain lazy until read, so auth failures cannot open TCP sockets.
 */
export async function withRequestResource<T extends RequestResource>(
  request: Request,
  acquire: () => T | null,
  handle: (resource: T | null) => Promise<Response> | Response,
  context: RequestContext,
): Promise<Response> {
  const resource = new URL(request.url).pathname.startsWith('/api/') ? acquire() : null
  try {
    return await handle(resource)
  } finally {
    if (resource !== null) {
      context.waitUntil(Promise.resolve().then(() => resource.close()).catch(() => undefined))
    }
  }
}
