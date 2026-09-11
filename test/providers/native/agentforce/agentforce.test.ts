import {readFileSync} from 'node:fs'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

import {classifyError} from '../../../../src/core/errors/classifier.js'
import {EventReporter} from '../../../../src/core/output/reporter.js'
import {StaticCredentialResolver} from '../../../../src/core/runtime/credential-resolver.js'
import {Runtime} from '../../../../src/core/runtime/runtime.js'
import {builtinRegistry} from '../../../../src/providers/index.js'
import {assertEnvelope} from '../../../helpers/envelope.js'
import {html, http, json, settle, startServer} from '../../../helpers/msw.js'
import {parse, providerHarness, type ProviderHarness} from '../../../helpers/provider-suite.js'

/**
 * P-agentforce over msw: READ-1..3, ERR-1..4, MUT-1..3, DISC-1, AUTH-1,
 * plus the carried-over session start, message, end sequence. The only
 * read is `agents list`, which is bounded by --limit rather than paged,
 * so READ-2 asserts the absence of a next page. No tenant walk.
 */
const MY_DOMAIN = 'https://example.my.salesforce.com'
const AGENT_API = 'https://api.salesforce.com'
const AGENT = '0XxAB000000AAAAAB1'
const SESSION = '5e3a1c8c-0000-4000-8000-000000000001'
const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/native/agentforce/${name}.json`, 'utf8')) as Record<string, unknown>

let h: ProviderHarness
const mock = startServer()

beforeAll(async () => {
  h = await providerHarness('agentforce')
})
afterAll(async () => {
  mock.server.close()
  await h.close()
})
afterEach(async () => {
  mock.reset()
  await h.fresh()
})

const creds = () => h.setEnv({AGENTFORCE_MY_DOMAIN_URL: MY_DOMAIN, AGENTFORCE_CLIENT_ID: 'consumer-key', AGENTFORCE_CLIENT_SECRET: 'consumer-secret'})
const token = () => http.post(`${MY_DOMAIN}/services/oauth2/token`, () => json({access_token: 'af-access', instance_url: MY_DOMAIN, token_type: 'Bearer', issued_at: '1'}))
const agents = (body: unknown = fixture('agents'), status = 200) => http.get(/\/services\/data\/v[\d.]+\/query$/, () => json(body, {status}))

describe('P-agentforce READ', () => {
  it('READ-1: agents list carries the agents, returned, and the Agent API support flag', async () => {
    creds()
    mock.server.use(token(), agents())
    const out = await h.run('agentforce:agents:list', ['--limit', '2', '--json'])
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{agents: Array<{id: string; supportedByAgentApi: boolean}>}>(parse(out))
    expect(env.result!.agents.map((a) => [a.id, a.supportedByAgentApi])).toEqual([[AGENT, true], ['0XxAB000000BBBBBB1', false]])
    expect(env._context).toMatchObject({pagination: {returned: 2}})
    const query = mock.seen.find((r) => r.path.includes('/query'))!
    expect(new URL(query.url).searchParams.get('q')).toContain('LIMIT 2')
  })

  it('READ-2: the listing is bounded by --limit and reports no further page', async () => {
    creds()
    mock.server.use(token(), agents())
    const env = assertEnvelope(parse(await h.run('agentforce:agents:list', ['--limit', '2', '--json'])))
    expect(env._context).toMatchObject({pagination: {hasMore: false, nextCommand: null}})
  })

  it('READ-3: --fields and --truncate apply', async () => {
    creds()
    mock.server.use(token(), agents())
    const env = assertEnvelope<{agents: Array<Record<string, unknown>>; defaultAgentId?: unknown}>(parse(await h.run('agentforce:agents:list', ['--fields', 'agents', '--truncate', '1', '--json'])))
    expect(Object.keys(env.result!)).toEqual(['agents'])
    expect(env.result!.agents).toHaveLength(2)
  })
})

describe('P-agentforce ERR', () => {
  it('ERR-1: a 401 that survives one token refresh exits 3 with an authentication error', async () => {
    creds()
    mock.server.use(token(), agents([{message: 'Session expired or invalid', errorCode: 'INVALID_SESSION_ID'}], 401))
    const out = await h.run('agentforce:agents:list', ['--json'])
    expect(out.code).toBe(3)
    const env = assertEnvelope(parse(out))
    expect(classifyError(env.error!.message)).toBe('auth_failed')
    await settle()
    expect(mock.seen.filter((r) => r.path === '/services/oauth2/token')).toHaveLength(2)
  })

  it('ERR-2: 403 maps to INSUFFICIENT_SCOPE with a hint', async () => {
    creds()
    mock.server.use(token(), agents([{message: 'Insufficient scope', errorCode: 'API_DISABLED_FOR_ORG'}], 403))
    expect(assertEnvelope(parse(await h.run('agentforce:agents:list', ['--json']))).error).toMatchObject({code: 'INSUFFICIENT_SCOPE', syntaxGuide: expect.stringContaining('chatbot_api')})
  })

  it('ERR-3: 429 is classified rate_limited in the health monitor', async () => {
    mock.server.use(token(), agents([{message: 'Too many requests', errorCode: 'REQUEST_LIMIT_EXCEEDED'}], 429))
    const runtime = await Runtime.start({cliRoot: process.cwd(), registry: builtinRegistry()})
    try {
      const r = await runtime.run({
        argv: ['agentforce', 'agents', 'list'],
        context: {requestId: 'p-af-err-3'},
        credentials: new StaticCredentialResolver(new Map([['agentforce', {instanceUrl: MY_DOMAIN, clientId: 'k', clientSecret: 's', authType: 'client-credentials'}]])),
        pool: runtime.pool,
        reporter: new EventReporter(),
      })
      expect(r.envelope.success).toBe(false)
      expect(runtime.healthMonitor.getHealth('agentforce')).toMatchObject({status: 'rate_limited', lastError: {classification: 'rate_limited'}})
    } finally {
      runtime.stop()
    }
  })

  it('ERR-4: an HTML body is classified hibernating', async () => {
    creds()
    mock.server.use(token(), http.get(/\/services\/data\/v[\d.]+\/query$/, () => html('<!DOCTYPE html><html><body>Down for maintenance</body></html>')))
    const env = assertEnvelope(parse(await h.run('agentforce:agents:list', ['--json'])))
    expect(env.success).toBe(false)
    expect(classifyError(env.error!.message)).toBe('hibernating')
  })
})

describe('P-agentforce MUT', () => {
  it('MUT-1: sessions start --dry-run sends no request', async () => {
    creds()
    const out = await h.run('agentforce:sessions:start', ['--agent-id', AGENT, '--dry-run'])
    expect(out.code, out.stderr).toBe(0)
    expect(parse(out)).toMatchObject({dryRun: true, wouldExecute: {agentId: AGENT}})
    expect(mock.seen).toEqual([])
  })

  it('MUT-2 and the carried-over sequence: start, message, end hit the Agent API with the expected paths and bodies', async () => {
    creds()
    mock.server.use(
      token(),
      http.post(`${AGENT_API}/einstein/ai-agent/v1/agents/${AGENT}/sessions`, () => json(fixture('session-start'))),
      http.post(`${AGENT_API}/einstein/ai-agent/v1/sessions/${SESSION}/messages`, () => json(fixture('session-message'))),
      http.delete(`${AGENT_API}/einstein/ai-agent/v1/sessions/${SESSION}`, () => new Response(null, {status: 204})),
    )
    const start = await h.run('agentforce:sessions:start', ['--agent-id', AGENT, '--confirm', '--json'])
    expect(start.code, start.stderr).toBe(0)
    expect(assertEnvelope<{sessionId: string}>(parse(start)).result!.sessionId).toBe(SESSION)
    const message = await h.run('agentforce:sessions:message', ['--session-id', SESSION, '--message', 'Where is order 42?', '--confirm', '--json'])
    expect(message.code, message.stderr).toBe(0)
    expect(assertEnvelope<{messages: Array<{message: string}>}>(parse(message)).result!.messages[0].message).toContain('shipped')
    const end = await h.run('agentforce:sessions:end', ['--session-id', SESSION, '--confirm', '--json'])
    expect(end.code, end.stderr).toBe(0)
    expect(assertEnvelope<{ended: boolean}>(parse(end)).result).toMatchObject({ended: true})
    await settle()
    const calls = mock.seen.filter((r) => r.path.startsWith('/einstein/'))
    expect(calls.map((r) => [r.method, r.path])).toEqual([
      ['POST', `/einstein/ai-agent/v1/agents/${AGENT}/sessions`],
      ['POST', `/einstein/ai-agent/v1/sessions/${SESSION}/messages`],
      ['DELETE', `/einstein/ai-agent/v1/sessions/${SESSION}`],
    ])
    expect(JSON.parse(calls[0].body)).toMatchObject({bypassUser: false, streamingCapabilities: {chunkTypes: ['Text']}, instanceConfig: {endpoint: MY_DOMAIN}})
    expect(JSON.parse(calls[1].body)).toMatchObject({message: {type: 'Text', text: 'Where is order 42?'}})
    expect(calls[2].headers['x-session-end-reason']).toBe('UserRequest')
    for (const c of calls) expect(c.headers.authorization).toBe('Bearer af-access')
  })

  it('MUT-3: sessions end without --confirm exits 2 before any request', async () => {
    creds()
    const out = await h.runWithHooks('agentforce:sessions:end', ['--session-id', SESSION, '--json'])
    expect(out.code).toBe(2)
    expect(out.stderr).toMatch(/--confirm/)
    expect(mock.seen).toEqual([])
  })
})

describe('P-agentforce DISC and AUTH', () => {
  it('DISC-1: discover exchanges a token and reports the hosts as reachable', async () => {
    creds()
    mock.server.use(token())
    const out = await h.run('agentforce:discover', ['--json'])
    expect(out.code, out.stderr).toBe(0)
    expect(assertEnvelope(parse(out)).result).toMatchObject({reachable: true, orgApiHost: MY_DOMAIN, agentApiHost: AGENT_API, myDomainUrl: MY_DOMAIN})
  })

  it('AUTH-1: client credentials are exchanged at the My Domain token endpoint and the bearer token follows', async () => {
    creds()
    mock.server.use(token(), agents())
    const out = await h.run('agentforce:agents:list', ['--json'])
    expect(out.code, out.stderr).toBe(0)
    await settle()
    expect(mock.seen[0].path).toBe('/services/oauth2/token')
    const params = new URLSearchParams(mock.seen[0].body)
    expect(params.get('grant_type')).toBe('client_credentials')
    expect(params.get('client_id')).toBe('consumer-key')
    expect(params.get('client_secret')).toBe('consumer-secret')
    expect(mock.seen[1].headers.authorization).toBe('Bearer af-access')
  })
})
