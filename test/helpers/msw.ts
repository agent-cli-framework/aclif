import {http, HttpResponse, type RequestHandler} from 'msw'
import {setupServer, type SetupServer} from 'msw/node'

export {http, HttpResponse}

/** A request the server saw, with its body read eagerly. */
export interface SeenRequest {
  method: string
  url: string
  path: string
  headers: Record<string, string>
  body: string
}

/**
 * msw server for provider fixture tests. Every request is recorded (method,
 * URL, headers, body) and an unhandled request fails the test.
 */
export function startServer(...handlers: RequestHandler[]): {server: SetupServer; seen: SeenRequest[]; reset(): void} {
  const server = setupServer(...handlers)
  const seen: SeenRequest[] = []
  const pending: Promise<void>[] = []
  server.events.on('request:start', ({request}) => {
    const url = new URL(request.url)
    const entry: SeenRequest = {method: request.method, url: request.url, path: url.pathname, headers: Object.fromEntries(request.headers.entries()), body: ''}
    seen.push(entry)
    pending.push(request.clone().text().then((t) => {
      entry.body = t
    }).catch(() => undefined))
  })
  server.listen({onUnhandledRequest: 'error'})
  return {
    server,
    seen,
    reset() {
      seen.length = 0
      server.resetHandlers()
    },
  }
}

/** Wait for every recorded body to be read. */
export const settle = () => new Promise((r) => setTimeout(r, 5))

export const json = (body: unknown, init?: ResponseInit) => HttpResponse.json(body as never, init)
export const html = (body: string, status = 200) => new HttpResponse(body, {status, headers: {'Content-Type': 'text/html'}})
