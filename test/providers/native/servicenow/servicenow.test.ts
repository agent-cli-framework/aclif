import {readFileSync} from 'node:fs'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

import {classifyError} from '../../../../src/core/errors/classifier.js'
import {EventReporter} from '../../../../src/core/output/reporter.js'
import {StaticCredentialResolver} from '../../../../src/core/runtime/credential-resolver.js'
import {Runtime} from '../../../../src/core/runtime/runtime.js'
import {builtinRegistry} from '../../../../src/providers/index.js'
import {tokenize} from '../../../../scripts/check-examples.js'
import {assertEnvelope} from '../../../helpers/envelope.js'
import {html, http, json, settle, startServer} from '../../../helpers/msw.js'
import {parse, providerHarness, type ProviderHarness} from '../../../helpers/provider-suite.js'

/**
 * P-servicenow over msw: READ-1..3, ERR-1..4, MUT-1..3, DISC-1, AUTH-1,
 * TEN-1..2, plus the carried-over encoded query passthrough and
 * hibernation page detection.
 */
const INSTANCE = 'https://example.service-now.com'
const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/native/servicenow/${name}.json`, 'utf8')) as Record<string, unknown>
const TABLE = (t: string) => new RegExp(`/api/now/table/${t}$`)

let h: ProviderHarness
const mock = startServer()
const queryArgv = (extra: string[] = []) => ['--table', 'incident', '--query', 'active=true^priority=1', '--limit', '2', ...extra, '--json']

beforeAll(async () => {
  h = await providerHarness('servicenow')
})
afterAll(async () => {
  mock.server.close()
  await h.close()
})
afterEach(async () => {
  mock.reset()
  await h.fresh()
})

const session = () => h.setEnv({SN_INSTANCE_URL: INSTANCE, SN_ACCESS_TOKEN: 'sn-token'})
const incidents = (total = 2, status = 200, body: unknown = fixture('incidents')) =>
  http.get(TABLE('incident'), () => json(body, {status, headers: {'X-Total-Count': String(total)}}))

describe('P-servicenow READ', () => {
  it('READ-1: table query carries records, returned, total from X-Total-Count, and the encoded query untouched', async () => {
    session()
    mock.server.use(incidents(2))
    const out = await h.run('servicenow:data:query', queryArgv())
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{records: unknown[]; totalCount: number}>(parse(out))
    expect(env.result!.records).toHaveLength(2)
    expect(env._context).toMatchObject({pagination: {returned: 2, total: 2, hasMore: false}})
    const url = new URL(mock.seen[0].url)
    expect(url.searchParams.get('sysparm_query')).toBe('active=true^priority=1')
    expect(url.searchParams.get('sysparm_limit')).toBe('2')
  })

  it('READ-2: more rows than returned yields a nextCommand with the next offset', async () => {
    session()
    mock.server.use(incidents(5))
    const env = assertEnvelope(parse(await h.run('servicenow:data:query', queryArgv())))
    const pagination = env._context!.pagination as {hasMore: boolean; nextCommand: string}
    expect(pagination.hasMore).toBe(true)
    const tokens = tokenize(pagination.nextCommand)
    expect(tokens.slice(0, 4)).toEqual(['aclif', 'servicenow', 'data', 'query'])
    expect(tokens[tokens.indexOf('--offset') + 1]).toBe('2')
    expect(tokens[tokens.indexOf('--query') + 1]).toBe('active=true^priority=1')
  })

  it('READ-3: --fields and --truncate apply', async () => {
    session()
    mock.server.use(incidents(2))
    const env = assertEnvelope<{records: Array<Record<string, unknown>>; _truncated: unknown}>(parse(await h.run('servicenow:data:query', queryArgv(['--fields', 'number', '--truncate', '1']))))
    expect(env.result!.records).toEqual([{number: 'INC0010001'}])
    expect(env.result!._truncated).toEqual({original: 2, returned: 1})
  })
})

describe('P-servicenow ERR', () => {
  it('ERR-1: 401 maps to AUTHENTICATION_FAILED and exit 3', async () => {
    session()
    mock.server.use(incidents(0, 401, {error: {message: 'User Not Authenticated', detail: 'Required to provide Auth information'}}))
    const out = await h.run('servicenow:data:query', queryArgv())
    expect(out.code).toBe(3)
    expect(assertEnvelope(parse(out)).error).toMatchObject({code: 'AUTHENTICATION_FAILED'})
  })

  it('ERR-2: 403 maps to INSUFFICIENT_ACCESS with a hint', async () => {
    session()
    mock.server.use(incidents(0, 403, {error: {message: 'Insufficient rights to query records', detail: 'Field(s) present in the query do not have permission to be read'}}))
    const env = assertEnvelope(parse(await h.run('servicenow:data:query', queryArgv())))
    expect(env.error).toMatchObject({code: 'INSUFFICIENT_ACCESS', syntaxGuide: expect.any(String)})
  })

  it('ERR-3: 429 is classified rate_limited in the health monitor', async () => {
    mock.server.use(incidents(0, 429, {error: {message: 'Too many requests'}}))
    const runtime = await Runtime.start({cliRoot: process.cwd(), registry: builtinRegistry()})
    try {
      const r = await runtime.run({
        argv: ['servicenow', 'data', 'query', '--table', 'incident', '--limit', '1'],
        context: {requestId: 'p-sn-err-3'},
        credentials: new StaticCredentialResolver(new Map([['servicenow', {instanceUrl: INSTANCE, accessToken: 'tok', authType: 'session'}]])),
        pool: runtime.pool,
        reporter: new EventReporter(),
      })
      expect(r.envelope.success).toBe(false)
      expect(runtime.healthMonitor.getHealth('servicenow')).toMatchObject({status: 'rate_limited', lastError: {classification: 'rate_limited'}})
    } finally {
      runtime.stop()
    }
  })

  it('ERR-4: the hibernation page and any other HTML body are classified hibernating', async () => {
    session()
    mock.server.use(http.get(TABLE('incident'), () => html('<html><body><h1>Instance Hibernating</h1><p>Please wait while we wake your instance</p></body></html>')))
    const asleep = assertEnvelope(parse(await h.run('servicenow:data:query', queryArgv())))
    expect(asleep.error!.message).toContain('hibernating')
    expect(classifyError(asleep.error!.message)).toBe('hibernating')
    await h.fresh()
    mock.server.use(http.get(TABLE('incident'), () => html('<!DOCTYPE html><html><body>Scheduled maintenance</body></html>')))
    const down = assertEnvelope(parse(await h.run('servicenow:data:query', queryArgv())))
    expect(classifyError(down.error!.message)).toBe('hibernating')
  })
})

describe('P-servicenow MUT', () => {
  const insert = ['insert', '--table', 'incident', '--values', '{"short_description":"Printer on fire"}', '--json']

  it('MUT-1: --dry-run sends no request and echoes the preview', async () => {
    session()
    const out = await h.run('servicenow:data:dml', [...insert, '--dry-run'])
    expect(out.code, out.stderr).toBe(0)
    expect(parse(out)).toMatchObject({dryRun: true, wouldExecute: {operation: 'insert', table: 'incident'}})
    expect(mock.seen).toEqual([])
  })

  it('MUT-2: --confirm sends POST /api/now/table/incident with the JSON body', async () => {
    session()
    mock.server.use(http.post(TABLE('incident'), () => json({result: {sys_id: 'new-sys-id', number: 'INC0010099', short_description: 'Printer on fire'}}, {status: 201})))
    const out = await h.run('servicenow:data:dml', [...insert, '--confirm'])
    expect(out.code, out.stderr).toBe(0)
    await settle()
    expect(mock.seen).toHaveLength(1)
    expect(mock.seen[0]).toMatchObject({method: 'POST', path: '/api/now/table/incident'})
    expect(JSON.parse(mock.seen[0].body)).toEqual({short_description: 'Printer on fire'})
    expect(assertEnvelope<{result: {sys_id: string}}>(parse(out)).result!.result.sys_id).toBe('new-sys-id')
  })

  it('MUT-3: script run without --confirm exits 2 before any request', async () => {
    session()
    const out = await h.runWithHooks('servicenow:script:run', ['--code', 'gs.info(1);', '--json'])
    expect(out.code).toBe(2)
    expect(out.stderr).toMatch(/--confirm/)
    expect(mock.seen).toEqual([])
  })
})

describe('P-servicenow DISC and AUTH', () => {
  const dictionary = () => [
    http.get(/\/api\/now\/table\/sys_db_object$/, ({request}) => {
      const q = new URL(request.url).searchParams.get('sysparm_query') ?? ''
      if (q.startsWith('name=')) return json({result: [{name: q.slice(5), super_class: ''}]})
      return json(fixture('tables'))
    }),
    http.get(/\/api\/now\/table\/sys_dictionary$/, () => json(fixture('dictionary-incident'))),
    http.get(/\/api\/now\/table\/sys_choice$/, () => json(fixture('choices-state'))),
  ]

  it('DISC-1: data describe reports the table with choice fields promoted to picklists and active choices only', async () => {
    session()
    mock.server.use(...dictionary())
    const out = await h.run('servicenow:data:describe', ['incident', '--include-choices', '--json'])
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{table: string; fieldCount: number; fields: Array<{name: string; type: string; picklistValues?: Array<{value: string}>}>}>(parse(out))
    expect(env.result).toMatchObject({table: 'incident', fieldCount: 5})
    const state = env.result!.fields.find((f) => f.name === 'state')!
    expect(state.type).toBe('picklist')
    expect(state.picklistValues?.map((p) => p.value)).toEqual(['1', '2', '7'])
    expect(env.result!.fields.find((f) => f.name === 'assigned_to')?.type).toBe('reference')
  })

  it('AUTH-1: a session token becomes a bearer header; username and password become HTTP basic', async () => {
    session()
    mock.server.use(incidents())
    await h.run('servicenow:data:query', queryArgv())
    expect(mock.seen[0].headers.authorization).toBe('Bearer sn-token')
    mock.reset()
    await h.fresh()
    h.setEnv({SN_ACCESS_TOKEN: undefined, SN_USERNAME: 'api.user', SN_PASSWORD: 'pw'})
    mock.server.use(incidents())
    const out = await h.run('servicenow:data:query', queryArgv())
    expect(out.code, out.stderr).toBe(0)
    expect(mock.seen[0].headers.authorization).toBe(`Basic ${Buffer.from('api.user:pw').toString('base64')}`)
  })
})

describe('P-servicenow TEN', () => {
  const walk = () => [
    http.get(/\/api\/now\/table\/sys_db_object$/, ({request}) => {
      const q = new URL(request.url).searchParams.get('sysparm_query') ?? ''
      if (q.startsWith('name=')) return json({result: [{name: q.slice(5), super_class: ''}]})
      return json(fixture('tables'))
    }),
    http.get(/\/api\/now\/table\/sys_dictionary$/, () => json(fixture('dictionary-incident'))),
    http.get(/\/api\/now\/table\/sys_choice$/, () => json(fixture('choices-state'))),
  ]

  it('TEN-1: introspect --bootstrap lists the core tables plus custom ones and marks u_ entities and fields custom', async () => {
    session()
    mock.server.use(...walk())
    const out = await h.run('servicenow:introspect', ['--bootstrap', '--json'])
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{entityNames: string[]; customEntities: number; cached: boolean}>(parse(out))
    expect(env.result!.entityNames).toEqual(['incident', 'u_asset_audit'])
    expect(env.result!.customEntities).toBe(1)
    const listing = new URL(mock.seen[0].url).searchParams.get('sysparm_query')!
    expect(listing).toMatch(/^nameIN.*\^ORnameSTARTSWITHu_\^ORnameSTARTSWITHx_$/)
    expect(mock.seen.every((r) => r.method === 'GET'), 'the walk only reads').toBe(true)
  })

  it('TEN-2: a second --bootstrap is cached with no request; --refresh walks again', async () => {
    session()
    mock.server.use(...walk())
    await h.run('servicenow:introspect', ['--bootstrap', '--json'])
    const walked = mock.seen.length
    mock.seen.length = 0
    expect(assertEnvelope<{cached: boolean}>(parse(await h.run('servicenow:introspect', ['--bootstrap', '--json']))).result!.cached).toBe(true)
    expect(mock.seen).toEqual([])
    expect(assertEnvelope<{cached: boolean}>(parse(await h.run('servicenow:introspect', ['--refresh', '--json']))).result!.cached).toBe(false)
    expect(mock.seen.length).toBe(walked)
  })
})
