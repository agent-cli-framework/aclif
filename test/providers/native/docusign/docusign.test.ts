import {generateKeyPairSync} from 'node:crypto'
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import jwt from 'jsonwebtoken'
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
 * P-docusign over msw: READ-1..3, ERR-1..4, MUT-1..3, DISC-1, AUTH-1,
 * plus the carried-over JWT grant assertion check. DocuSign has no
 * tenant walk, so TEN rows do not apply.
 */
const AUTH_SERVER = 'account-d.docusign.com'
const BASE = 'https://demo.docusign.net'
const ACCOUNT = 'acct-0000-0000-0000-000000000001'
const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/native/docusign/${name}.json`, 'utf8')) as Record<string, unknown>
const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048, publicKeyEncoding: {type: 'spki', format: 'pem'}, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}})

let h: ProviderHarness
const mock = startServer()
const ENVELOPES = new RegExp(`/restapi/v2.1/accounts/${ACCOUNT}/envelopes$`)

beforeAll(async () => {
  h = await providerHarness('docusign')
})
afterAll(async () => {
  mock.server.close()
  await h.close()
})
afterEach(async () => {
  mock.reset()
  await h.fresh()
})

const creds = () => h.setEnv({DS_INTEGRATION_KEY: 'integration-key', DS_USER_ID: 'user-guid', DS_ACCOUNT_ID: ACCOUNT, DS_PRIVATE_KEY: privateKey, DS_BASE_URI: BASE})
const tokenHandlers = (tokenStatus = 200) => [
  http.post(`https://${AUTH_SERVER}/oauth/token`, () => json({access_token: 'ds-access', expires_in: 3600, token_type: 'Bearer'}, {status: tokenStatus})),
  http.get(`https://${AUTH_SERVER}/oauth/userinfo`, () => json(fixture('userinfo'))),
]
const envelopes = (body: unknown = fixture('envelopes'), status = 200) => http.get(ENVELOPES, () => json(body, {status}))
const listArgv = ['--from-date', '2026-01-01', '--limit', '2', '--json']

describe('P-docusign READ', () => {
  it('READ-1: envelopes list carries the envelopes, returned, and total', async () => {
    creds()
    mock.server.use(...tokenHandlers(), envelopes())
    const out = await h.run('docusign:envelopes:list', listArgv)
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{envelopes: unknown[]}>(parse(out))
    expect(env.result!.envelopes).toHaveLength(2)
    expect(env._context).toMatchObject({pagination: {returned: 2, total: 5, hasMore: true}})
    const list = mock.seen.find((r) => ENVELOPES.test(r.path))!
    const url = new URL(list.url)
    expect(url.searchParams.get('from_date')).toBe('2026-01-01')
    expect(url.searchParams.get('count')).toBe('2')
  })

  it('READ-2: nextUri yields a nextCommand carrying the next start position', async () => {
    creds()
    mock.server.use(...tokenHandlers(), envelopes())
    const env = assertEnvelope(parse(await h.run('docusign:envelopes:list', listArgv)))
    const pagination = env._context!.pagination as {nextCommand: string}
    const tokens = tokenize(pagination.nextCommand)
    expect(tokens.slice(0, 4)).toEqual(['aclif', 'docusign', 'envelopes', 'list'])
    expect(tokens[tokens.indexOf('--start-position') + 1]).toBe('2')
    expect(tokens[tokens.indexOf('--limit') + 1]).toBe('2')
    await h.fresh()
    mock.server.use(envelopes({...fixture('envelopes'), nextUri: undefined}))
    const last = assertEnvelope(parse(await h.run('docusign:envelopes:list', listArgv)))
    expect(last._context).toMatchObject({pagination: {hasMore: false, nextCommand: null}})
  })

  it('READ-3: --fields and --truncate apply to the envelope list', async () => {
    creds()
    mock.server.use(...tokenHandlers(), envelopes())
    const env = assertEnvelope<{envelopes: Array<Record<string, unknown>>; totalSetSize: string}>(parse(await h.run('docusign:envelopes:list', [...listArgv, '--fields', 'envelopes,totalSetSize', '--truncate', '1'])))
    expect(Object.keys(env.result!).sort()).toEqual(['envelopes', 'totalSetSize'])
    expect(env.result!.envelopes).toHaveLength(2)
  })
})

describe('P-docusign ERR', () => {
  it('ERR-1: a 401 that survives one token refresh maps to AUTHENTICATION_FAILED and exit 3', async () => {
    creds()
    mock.server.use(...tokenHandlers(), envelopes({errorCode: 'AUTHORIZATION_INVALID_TOKEN', message: 'The access token provided is expired, revoked or malformed.'}, 401))
    const out = await h.run('docusign:envelopes:list', listArgv)
    expect(out.code).toBe(3)
    expect(assertEnvelope(parse(out)).error).toMatchObject({code: 'AUTHENTICATION_FAILED', syntaxGuide: expect.stringContaining('integration key')})
    await settle()
    expect(mock.seen.filter((r) => r.path === '/oauth/token'), 'one refresh attempt before giving up').toHaveLength(2)
  })

  it('ERR-2: 403 maps to INSUFFICIENT_ACCESS with a hint', async () => {
    creds()
    mock.server.use(...tokenHandlers(), envelopes({errorCode: 'USER_LACKS_PERMISSIONS', message: 'This user lacks sufficient permissions.'}, 403))
    expect(assertEnvelope(parse(await h.run('docusign:envelopes:list', listArgv))).error).toMatchObject({code: 'INSUFFICIENT_ACCESS', syntaxGuide: expect.any(String)})
  })

  it('ERR-3: 429 is classified rate_limited in the health monitor', async () => {
    mock.server.use(...tokenHandlers(), envelopes({errorCode: 'HOURLY_APIINVOCATION_LIMIT_EXCEEDED', message: 'The maximum number of hourly API invocations has been exceeded.'}, 429))
    const runtime = await Runtime.start({cliRoot: process.cwd(), registry: builtinRegistry()})
    try {
      const r = await runtime.run({
        argv: ['docusign', 'envelopes', 'list', '--from-date', '2026-01-01'],
        context: {requestId: 'p-ds-err-3'},
        credentials: new StaticCredentialResolver(new Map([['docusign', {instanceUrl: BASE, integrationKey: 'k', impersonatedUserId: 'u', dsAccountId: ACCOUNT, privateKey, authType: 'jwt-grant'}]])),
        pool: runtime.pool,
        reporter: new EventReporter(),
      })
      expect(r.envelope.success).toBe(false)
      expect(runtime.healthMonitor.getHealth('docusign')).toMatchObject({status: 'rate_limited', lastError: {classification: 'rate_limited'}})
    } finally {
      runtime.stop()
    }
  })

  it('ERR-4: an HTML body is classified hibernating', async () => {
    creds()
    mock.server.use(...tokenHandlers(), http.get(ENVELOPES, () => html('<!DOCTYPE html><html><body>We are performing maintenance</body></html>')))
    const env = assertEnvelope(parse(await h.run('docusign:envelopes:list', listArgv)))
    expect(env.success).toBe(false)
    expect(classifyError(env.error!.message)).toBe('hibernating')
  })
})

describe('P-docusign MUT', () => {
  it('MUT-1: envelopes create --dry-run sends no request', async () => {
    creds()
    const out = await h.run('docusign:envelopes:create', ['--file', './nda.md', '--subject', 'Sign', '--signer-email', 'a@example.com', '--signer-name', 'A', '--status', 'created', '--dry-run'])
    expect(out.code, out.stderr).toBe(0)
    expect(parse(out)).toMatchObject({dryRun: true, wouldExecute: {status: 'created', signerEmail: 'a@example.com'}})
    expect(mock.seen).toEqual([])
  })

  it('MUT-2: envelopes create --confirm posts the envelope with the document and signer', async () => {
    creds()
    const file = join(h.home, 'nda.md')
    writeFileSync(file, '# NDA\n\nPlease sign below.\n\n/sn1/\n')
    mock.server.use(...tokenHandlers(), http.post(ENVELOPES, () => json({envelopeId: 'env-new', status: 'sent', uri: '/envelopes/env-new'}, {status: 201})))
    const out = await h.run('docusign:envelopes:create', ['--file', file, '--subject', 'Please sign NDA', '--signer-email', 'alice@example.com', '--signer-name', 'Alice', '--status', 'sent', '--confirm', '--json'])
    expect(out.code, out.stderr).toBe(0)
    await settle()
    const post = mock.seen.find((r) => r.method === 'POST' && ENVELOPES.test(r.path))!
    const body = JSON.parse(post.body) as {emailSubject: string; status: string; documents: unknown[]; recipients: {signers: Array<{email: string; name: string}>}}
    expect(body).toMatchObject({emailSubject: 'Please sign NDA', status: 'sent'})
    expect(body.documents).toHaveLength(1)
    expect(body.recipients.signers[0]).toMatchObject({email: 'alice@example.com', name: 'Alice'})
    expect(post.headers.authorization).toBe('Bearer ds-access')
    expect(assertEnvelope<{envelopeId: string}>(parse(out)).result).toMatchObject({envelopeId: 'env-new'})
  })

  it('MUT-3: envelopes delete without --confirm exits 2 before any request', async () => {
    creds()
    const out = await h.run('docusign:envelopes:delete', ['--envelope-id', 'env-1', '--json'])
    expect(out.code).toBe(2)
    expect(assertEnvelope(parse(out)).error).toMatchObject({code: 'CONFIRMATION_REQUIRED'})
    expect(mock.seen).toEqual([])
  })
})

describe('P-docusign DISC and AUTH', () => {
  it('DISC-1: discover probes the account and reports reachability and topics', async () => {
    creds()
    mock.server.use(...tokenHandlers(), envelopes())
    const out = await h.run('docusign:discover', ['--json'])
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{reachable: boolean; accountId: string; envelopesVisible: number; topics: Array<{name: string}>}>(parse(out))
    expect(env.result).toMatchObject({reachable: true, accountId: ACCOUNT, envelopesVisible: 2})
    expect(env.result!.topics.map((t) => t.name)).toContain('envelopes')
  })

  it('AUTH-1: the JWT grant assertion is signed with the private key and names the integration key, user, and auth server', async () => {
    creds()
    mock.server.use(...tokenHandlers(), envelopes())
    const out = await h.run('docusign:envelopes:list', listArgv)
    expect(out.code, out.stderr).toBe(0)
    await settle()
    const token = mock.seen.find((r) => r.path === '/oauth/token')!
    const params = new URLSearchParams(token.body)
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    const claims = jwt.verify(params.get('assertion')!, publicKey, {algorithms: ['RS256']}) as {iss: string; sub: string; aud: string; scope: string}
    expect(claims).toMatchObject({iss: 'integration-key', sub: 'user-guid', aud: AUTH_SERVER, scope: 'signature impersonation'})
    expect(mock.seen.map((r) => r.path)).toEqual(['/oauth/token', '/oauth/userinfo', `/restapi/v2.1/accounts/${ACCOUNT}/envelopes`])
    expect(mock.seen[2].headers.authorization).toBe('Bearer ds-access')
    // The session is reused: a second command performs no token exchange.
    mock.seen.length = 0
    mock.server.use(envelopes())
    await h.run('docusign:envelopes:list', listArgv)
    expect(mock.seen.map((r) => r.path)).toEqual([`/restapi/v2.1/accounts/${ACCOUNT}/envelopes`])
  })
})
