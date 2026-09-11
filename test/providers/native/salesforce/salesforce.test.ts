import {readFileSync} from 'node:fs'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

import {classifyError} from '../../../../src/core/errors/classifier.js'
import {EventReporter} from '../../../../src/core/output/reporter.js'
import {StaticCredentialResolver} from '../../../../src/core/runtime/credential-resolver.js'
import {Runtime} from '../../../../src/core/runtime/runtime.js'
import {FileTenantCache} from '../../../../src/cli/config/tenant-cache.js'
import {instanceKey} from '../../../../src/core/provider/tenant.js'
import {builtinRegistry} from '../../../../src/providers/index.js'
import {tokenize} from '../../../../scripts/check-examples.js'
import {assertEnvelope} from '../../../helpers/envelope.js'
import {html, http, json, settle, startServer} from '../../../helpers/msw.js'
import {parse, providerHarness, type ProviderHarness} from '../../../helpers/provider-suite.js'

/**
 * P-salesforce: recorded responses served by msw to the real jsforce
 * client. Rows READ-1..3, ERR-1..4, MUT-1..3, DISC-1, AUTH-1, TEN-1..2,
 * plus the carried-over aggregate alias correction.
 */
const INSTANCE = 'https://example.my.salesforce.com'
const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/native/salesforce/${name}.json`, 'utf8')) as Record<string, unknown>
const API = /\/services\/data\/v[\d.]+/
const soapLogin = (sessionId: string) =>
  '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="urn:partner.soap.sforce.com"><soapenv:Body><loginResponse><result>' +
  `<serverUrl>${INSTANCE}/services/Soap/u/59.0/00Dxx</serverUrl><sessionId>${sessionId}</sessionId><userId>005xx</userId>` +
  '<userInfo><organizationId>00Dxx</organizationId><userName>u@example.com</userName></userInfo></result></loginResponse></soapenv:Body></soapenv:Envelope>'

let h: ProviderHarness
const mock = startServer()
const query: [string, string[]] = ['salesforce:data:query', ['--query', 'SELECT Id, Name, Industry FROM Account', '--json']]

beforeAll(async () => {
  h = await providerHarness('salesforce')
})
afterAll(async () => {
  mock.server.close()
  await h.close()
})
afterEach(async () => {
  mock.reset()
  await h.fresh()
})

const session = () => h.setEnv({SF_INSTANCE_URL: INSTANCE, SF_ACCESS_TOKEN: 'session-token'})
const queryHandler = (body: unknown = fixture('query'), status = 200) =>
  http.get(new RegExp(`${API.source}/query$`), () => json(body, {status}))

describe('P-salesforce READ', () => {
  it('READ-1: query happy path carries records, pagination, and returned equal to the record count', async () => {
    session()
    mock.server.use(queryHandler())
    const out = await h.run(...query)
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{records: unknown[]; totalSize: number; done: boolean}>(parse(out))
    expect(env.result!.records).toHaveLength(2)
    expect(env._context).toMatchObject({pagination: {returned: 2, total: 2, hasMore: false, nextCommand: null}})
    expect(mock.seen.map((r) => r.path)).toEqual(['/services/data/v59.0/query'])
  })

  it('READ-2: an incomplete result yields a nextCommand that parses and carries the next offset', async () => {
    session()
    mock.server.use(queryHandler({...fixture('query'), totalSize: 5, done: false}))
    const out = await h.run('salesforce:data:query', ['--query', 'SELECT Id FROM Account', '--limit', '2', '--json'])
    const env = assertEnvelope(parse(out))
    const pagination = env._context!.pagination as {hasMore: boolean; nextCommand: string}
    expect(pagination.hasMore).toBe(true)
    const tokens = tokenize(pagination.nextCommand)
    expect(tokens.slice(0, 4)).toEqual(['aclif', 'salesforce', 'data', 'query'])
    expect(tokens[tokens.indexOf('--offset') + 1]).toBe('2')
    expect(tokens[tokens.indexOf('--limit') + 1]).toBe('2')
  })

  it('READ-3: --fields and --truncate apply to provider output', async () => {
    session()
    mock.server.use(queryHandler())
    const out = await h.run('salesforce:data:query', ['--query', 'SELECT Id, Name FROM Account', '--fields', 'Id', '--truncate', '1', '--json'])
    const env = assertEnvelope<{records: Array<Record<string, unknown>>; _truncated: {original: number; returned: number}}>(parse(out))
    expect(env.result!.records).toEqual([{Id: '001xx000003GYRAAA4'}])
    expect(env.result!._truncated).toEqual({original: 2, returned: 1})
  })
})

describe('P-salesforce ERR', () => {
  it('ERR-1: 401 maps to AUTHENTICATION_FAILED and exit 3', async () => {
    session()
    mock.server.use(queryHandler([{errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid'}], 401))
    const out = await h.run(...query)
    expect(out.code).toBe(3)
    const env = assertEnvelope(parse(out))
    expect(env.error).toMatchObject({code: 'AUTHENTICATION_FAILED', syntaxGuide: expect.stringContaining('auth logout')})
  })

  it('ERR-2: 403 maps to INSUFFICIENT_ACCESS with a hint', async () => {
    session()
    mock.server.use(queryHandler([{errorCode: 'INSUFFICIENT_ACCESS_OR_READONLY', message: 'insufficient access rights on object id'}], 403))
    const out = await h.run(...query)
    const env = assertEnvelope(parse(out))
    expect(env.error).toMatchObject({code: 'INSUFFICIENT_ACCESS', syntaxGuide: expect.any(String)})
  })

  it('ERR-3: REQUEST_LIMIT_EXCEEDED is classified rate_limited in the health monitor', async () => {
    mock.server.use(queryHandler([{errorCode: 'REQUEST_LIMIT_EXCEEDED', message: 'TotalRequests Limit exceeded.'}], 403))
    const runtime = await Runtime.start({cliRoot: process.cwd(), registry: builtinRegistry()})
    try {
      const r = await runtime.run({
        argv: ['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account'],
        context: {requestId: 'p-sf-err-3'},
        credentials: new StaticCredentialResolver(new Map([['salesforce', {instanceUrl: INSTANCE, accessToken: 'tok', authType: 'session'}]])),
        pool: runtime.pool,
        reporter: new EventReporter(),
      })
      expect(r.envelope.error).toMatchObject({code: 'RATE_LIMITED'})
      expect(runtime.healthMonitor.getHealth('salesforce')).toMatchObject({status: 'rate_limited', lastError: {classification: 'rate_limited'}})
    } finally {
      runtime.stop()
    }
  })

  it('ERR-4: an HTML body is classified hibernating, and a login page auth_required', async () => {
    session()
    mock.server.use(http.get(new RegExp(`${API.source}/query$`), () => html('<!DOCTYPE html><html><body>Maintenance in progress</body></html>')))
    const down = assertEnvelope(parse(await h.run(...query)))
    expect(down.success).toBe(false)
    expect(classifyError(down.error!.message)).toBe('hibernating')
    await h.fresh()
    mock.server.use(http.get(new RegExp(`${API.source}/query$`), () => html('<html><body><form>Please log in to Salesforce</form></body></html>')))
    const login = assertEnvelope(parse(await h.run(...query)))
    expect(classifyError(login.error!.message)).toBe('auth_required')
    expect(login.error!.code).toBe('AUTHENTICATION_FAILED')
  })

  it('carried over: the aggregate alias ORDER BY error is corrected from the failing query', async () => {
    session()
    mock.server.use(queryHandler([{errorCode: 'INVALID_FIELD', message: "\nORDER BY Cases DESC\n         ^\nERROR at Row:1:Column:60\nNo such column 'Cases' on entity 'Case'."}], 400))
    const out = await h.run('salesforce:data:query', ['--query', 'SELECT AccountId, COUNT(Id) Cases FROM Case GROUP BY AccountId ORDER BY Cases DESC', '--json'])
    const env = assertEnvelope(parse(out))
    expect(env.error).toMatchObject({code: 'SOQL_AGGREGATE_ALIAS_ORDER_BY', correctedValue: 'SELECT AccountId, COUNT(Id) Cases FROM Case GROUP BY AccountId ORDER BY COUNT(Id) DESC'})
  })
})

describe('P-salesforce MUT', () => {
  const insert: [string, string[]] = ['salesforce:data:dml', ['insert', 'Account', '--values', '{"Name":"Dry Run Co"}', '--json']]

  it('MUT-1: --dry-run sends no request and echoes the preview', async () => {
    session()
    const out = await h.run(insert[0], [...insert[1], '--dry-run'])
    expect(out.code, out.stderr).toBe(0)
    expect(parse(out)).toMatchObject({dryRun: true, wouldExecute: {operation: 'insert', objectName: 'Account'}})
    expect(mock.seen).toEqual([])
  })

  it('MUT-2: --confirm sends the expected method, path, and body', async () => {
    session()
    mock.server.use(http.post(new RegExp(`${API.source}/sobjects/Account$`), () => json({id: '001xx000003NEW', success: true, errors: []}, {status: 201})))
    const out = await h.run(insert[0], [...insert[1], '--confirm'])
    expect(out.code, out.stderr).toBe(0)
    await settle()
    const post = mock.seen.find((r) => r.method === 'POST')!
    expect(post.path).toBe('/services/data/v59.0/sobjects/Account')
    expect(JSON.parse(post.body)).toEqual({Name: 'Dry Run Co'})
    expect(post.headers.authorization).toBe('Bearer session-token')
    expect(assertEnvelope(parse(out)).success).toBe(true)
  })

  it('MUT-3: a command that requires confirmation exits 2 before any request without --confirm', async () => {
    session()
    const out = await h.runWithHooks('salesforce:apex:run', ['--code', 'System.debug(1);', '--json'])
    expect(out.code).toBe(2)
    expect(out.stderr).toMatch(/--confirm/)
    expect(mock.seen).toEqual([])
  })
})

describe('P-salesforce DISC and AUTH', () => {
  it('DISC-1: data describe reports one object with its fields and picklist values', async () => {
    session()
    mock.server.use(http.get(new RegExp(`${API.source}/sobjects/Account/describe$`), () => json(fixture('describe-account'))))
    const out = await h.run('salesforce:data:describe', ['Account', '--json'])
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{name: string; fieldCount: number; fields: Array<{name: string; type: string}>}>(parse(out))
    expect(env.result).toMatchObject({name: 'Account', custom: false, fieldCount: 4})
    expect(env.result!.fields.map((f) => f.name)).toEqual(['Id', 'Name', 'Tier__c', 'OwnerId'])
  })

  it('AUTH-1: the session path sends a bearer token; username and password perform a SOAP login; client credentials use the token endpoint', async () => {
    session()
    mock.server.use(queryHandler())
    await h.run(...query)
    expect(mock.seen[0].headers.authorization).toBe('Bearer session-token')

    mock.reset()
    await h.fresh()
    h.setEnv({SF_ACCESS_TOKEN: undefined, SF_USERNAME: 'u@example.com', SF_PASSWORD: 'pw', SF_SECURITY_TOKEN: 'tok', SF_LOGIN_URL: INSTANCE})
    mock.server.use(
      http.post(/\/services\/Soap\/u\//, () => new Response(soapLogin('SOAP-SESSION'), {headers: {'Content-Type': 'text/xml'}})),
      queryHandler(),
    )
    const viaPassword = await h.run(...query)
    expect(viaPassword.code, viaPassword.stderr).toBe(0)
    await settle()
    expect(mock.seen[0].method).toBe('POST')
    expect(mock.seen[0].path).toMatch(/\/services\/Soap\/u\//)
    expect(mock.seen[0].body).toContain('pwtok')
    expect(mock.seen[0].body).toContain('u@example.com')
    expect(mock.seen[1].headers.authorization).toBe('Bearer SOAP-SESSION')

    mock.reset()
    await h.fresh()
    h.setEnv({SF_USERNAME: undefined, SF_PASSWORD: undefined, SF_SECURITY_TOKEN: undefined, SF_LOGIN_URL: undefined, SF_CLIENT_ID: 'cid', SF_CLIENT_SECRET: 'csecret'})
    mock.server.use(
      http.post(/\/services\/oauth2\/token$/, () => json({access_token: 'OAUTH-TOKEN', instance_url: INSTANCE, id: 'https://login.salesforce.com/id/00Dxx/005xx', token_type: 'Bearer'})),
      queryHandler(),
    )
    const viaOauth = await h.run(...query)
    expect(viaOauth.code, viaOauth.stderr).toBe(0)
    await settle()
    expect(mock.seen[0].path).toBe('/services/oauth2/token')
    expect(new URLSearchParams(mock.seen[0].body).get('grant_type')).toBe('client_credentials')
    expect(new URLSearchParams(mock.seen[0].body).get('client_id')).toBe('cid')
    expect(mock.seen[1].headers.authorization).toBe('Bearer OAUTH-TOKEN')
  })
})

describe('P-salesforce TEN', () => {
  const walk = () => [
    http.get(new RegExp(`${API.source}/sobjects/?$`), () => json(fixture('describe-global'))),
    http.get(new RegExp(`${API.source}/sobjects/Warranty__c/describe$`), () => json(fixture('describe-warranty'))),
    http.get(new RegExp(`${API.source}/sobjects/Account/describe$`), () => json(fixture('describe-account'))),
    http.get(new RegExp(`${API.source}/sobjects/(\\w+)/describe$`), ({request}) => {
      const name = new URL(request.url).pathname.split('/').at(-2)!
      return json({...fixture('describe-account'), name, label: name, custom: false, fields: (fixture('describe-account').fields as unknown[]).slice(0, 2)})
    }),
  ]

  it('TEN-1: introspect --bootstrap builds the catalogue from the fixture org: custom entity, custom field on a standard entity, enum, reference', async () => {
    session()
    mock.server.use(...walk())
    const out = await h.run('salesforce:introspect', ['--bootstrap', '--json'])
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{cached: boolean; entityNames: string[]; customEntities: number}>(parse(out))
    expect(env.result).toMatchObject({cached: false, customEntities: 1})
    expect(env.result!.entityNames).toEqual(['Account', 'Warranty__c'])
    // Custom objects plus the core standard objects present in the org: Task and AccountHistory are not described.
    expect(mock.seen.filter((r) => r.path.endsWith('/describe')).map((r) => r.path.split('/').at(-2)).sort()).toEqual(['Account', 'Contact', 'Warranty__c'])
    const catalog = await new FileTenantCache(h.config.cacheDir).load('salesforce', instanceKey('salesforce', {instanceUrl: INSTANCE, accessToken: 'session-token', authType: 'session'}))
    const warranty = catalog!.entities.find((e) => e.name === 'Warranty__c')!
    expect(warranty.fields.find((f) => f.name === 'Status__c')?.enum).toEqual(['Open', 'Closed'])
    expect(warranty.fields.find((f) => f.name === 'Account__c')?.references).toEqual(['Account'])
    expect(catalog!.entities.find((e) => e.name === 'Account')?.fields.map((f) => f.name)).toEqual(['Tier__c'])
  })

  it('TEN-2: a second --bootstrap is served from the cache with no request; --refresh walks again', async () => {
    session()
    mock.server.use(...walk())
    await h.run('salesforce:introspect', ['--bootstrap', '--json'])
    const walked = mock.seen.length
    expect(walked).toBeGreaterThan(1)
    mock.seen.length = 0
    const again = assertEnvelope<{cached: boolean}>(parse(await h.run('salesforce:introspect', ['--bootstrap', '--json'])))
    expect(again.result!.cached).toBe(true)
    expect(mock.seen).toEqual([])
    const refreshed = assertEnvelope<{cached: boolean}>(parse(await h.run('salesforce:introspect', ['--refresh', '--json'])))
    expect(refreshed.result!.cached).toBe(false)
    expect(mock.seen.length).toBe(walked)
  })
})
