import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {signHs256} from '../../src/core/identity/index.js'
import {runBinary} from '../../scripts/capture-golden.js'
import {startSalesforceStub} from '../helpers/salesforce-stub.js'

/**
 * End-to-end rows through the built binary with an empty environment:
 * E-1, E-3, E-4, E-8, E-10, E-11.
 */
let home: string
let configHome: string
let dirname: string

async function writeConfig(text: string): Promise<void> {
  const dir = join(configHome, dirname)
  await mkdir(dir, {recursive: true})
  await writeFile(join(dir, 'config.yaml'), text)
}

function audit(stderr: string): Record<string, unknown> | undefined {
  const line = stderr.split('\n').find((l) => l.startsWith('[AUDIT] '))
  return line ? (JSON.parse(line.slice('[AUDIT] '.length)) as Record<string, unknown>) : undefined
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'aclif-e2e-'))
  configHome = join(home, 'xdg-config')
  dirname = (JSON.parse(await readFile('package.json', 'utf8')) as {oclif: {dirname: string}}).oclif.dirname
})
afterAll(async () => {
  await rm(home, {recursive: true, force: true})
})

const env = () => ({XDG_CONFIG_HOME: configHome})

describe('standalone binary, empty environment', () => {
  it('E-1: discover with an empty environment exits 0 and lists every provider as not configured', async () => {
    const out = await runBinary(['discover', '--json'], home, env())
    expect(out.code, out.stderr).toBe(0)
    const body = JSON.parse(out.stdout) as {providers: Array<{name: string; status: string}>}
    expect(body.providers.length).toBeGreaterThan(0)
    for (const p of body.providers) expect(p.status, p.name).toBe('not configured')
  }, 60_000)

  it('E-3: --schema with an empty environment exits 0 and lists the new base flags only', async () => {
    const out = await runBinary(['salesforce', 'data', 'query', '--schema'], home, env())
    expect(out.code, out.stderr).toBe(0)
    const schema = JSON.parse(out.stdout) as {flags: Record<string, unknown>}
    for (const f of ['profile', 'confirm', 'identity-token', 'instance']) expect(schema.flags).toHaveProperty(f)
    for (const f of ['sso-token', 'service-account', 'target-org', 'env']) expect(schema.flags).not.toHaveProperty(f)
  }, 60_000)

  it('E-4 and E-11: a read with no credentials exits 3 with a JSON error listing auth paths, and an audit line', async () => {
    const out = await runBinary(['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account LIMIT 1'], home, env())
    expect(out.code).toBe(3)
    const body = JSON.parse(out.stdout) as {success: boolean; error: {code: string; syntaxGuide: string}}
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('NO_CREDENTIALS')
    expect(body.error.syntaxGuide).toContain('--instance-url')
    expect(body.error.syntaxGuide).not.toContain('vault')
    expect(audit(out.stderr)).toMatchObject({user: null, command: 'salesforce:data:query', exitCode: 3})
  }, 60_000)

  it('E-11: an audit line follows a successful command with user null when anonymous', async () => {
    const out = await runBinary(['discover', '--json'], home, env())
    expect(audit(out.stderr)).toMatchObject({user: null, command: 'discover', exitCode: 0})
  }, 60_000)

  it('E-8: --profile applies credentials from the config file; a missing profile is a clear exit 2', async () => {
    // Session auth against a closed local port: no login round trip, no
    // network, and a connection error that proves the profile was applied.
    await writeConfig(
      'profiles:\n  dev:\n    salesforce:\n      instance_url: http://127.0.0.1:1\n      access_token: not-a-real-token\n',
    )
    const query = ['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account LIMIT 1']
    const withProfile = await runBinary([...query, '--profile', 'dev'], home, env())
    const body = JSON.parse(withProfile.stdout) as {success: boolean; error: {code: string; message: string}}
    expect(body.success).toBe(false)
    expect(body.error.code).not.toBe('NO_CREDENTIALS')
    expect(body.error.message).toMatch(/ECONNREFUSED|127\.0\.0\.1|connect/i)

    const without = await runBinary(query, home, env())
    expect(without.code).toBe(3)
    expect((JSON.parse(without.stdout) as {error: {code: string}}).error.code).toBe('NO_CREDENTIALS')

    const missing = await runBinary([...query, '--profile', 'missing'], home, env())
    expect(missing.code).toBe(2)
    expect(missing.stderr).toMatch(/Profile 'missing' not found/)
    await writeConfig('')
  }, 60_000)

  it('E-10: require_identity denies without a token and admits a valid static JWT; a tampered token is rejected', async () => {
    await writeConfig('policy:\n  require_identity: true\nidentity:\n  provider: static-jwt\n')
    const denied = await runBinary(['discover', '--json'], home, env())
    expect(denied.code).toBe(3)
    expect(denied.stderr).toMatch(/Identity required/)

    const secret = 'e2e-secret'
    const token = signHs256({sub: 'alice', email: 'alice@example.com'}, secret)
    const admitted = await runBinary(['discover', '--json'], home, {...env(), ACLIF_IDENTITY_TOKEN: token, ACLIF_IDENTITY_SECRET: secret})
    expect(admitted.code, admitted.stderr).toBe(0)
    expect(audit(admitted.stderr)).toMatchObject({user: 'alice', exitCode: 0})

    const tampered = await runBinary(['discover', '--json'], home, {...env(), ACLIF_IDENTITY_TOKEN: token.slice(0, -2) + 'xx', ACLIF_IDENTITY_SECRET: secret})
    expect(tampered.code).toBe(3)
    expect(tampered.stderr).toMatch(/rejected/)
    await writeConfig('')
  }, 60_000)
})

describe('E-13 manifest commands in the standalone binary', () => {
  it('a manifest listed for the selected profile answers --schema; another profile does not have it', async () => {
    const manifestDir = join(configHome, dirname)
    await mkdir(manifestDir, {recursive: true})
    const apex = await readFile('test/fixtures/manifests/salesforce-apex-quote-summary.json', 'utf8')
    await writeFile(join(manifestDir, 'apex.json'), apex)
    await writeConfig('default_profile: dev\nprofiles:\n  dev: {}\n  other: {}\nmanifests:\n  dev:\n    salesforce: [./apex.json]\n')
    const out = await runBinary(['salesforce', 'apex', 'quote-summary', '--schema'], home, env())
    expect(out.code, out.stderr).toBe(0)
    const schema = JSON.parse(out.stdout) as {command: string; flags: Record<string, unknown>}
    expect(schema.command).toBe('salesforce:apex:quote-summary')
    expect(schema.flags).toHaveProperty('quote-id')
    const other = await runBinary(['salesforce', 'apex', 'quote-summary', '--schema', '--profile', 'other'], home, env())
    expect(other.code).not.toBe(0)
    expect(other.stderr).toMatch(/not found/)
    await writeConfig('')
  }, 60_000)
})

describe('E-15 and E-16 credential storage', () => {
  it('E-15: {env} and {exec} profile sources resolve; a readable config with a literal secret warns once and still runs', async () => {
    await writeConfig(
      'profiles:\n  dev:\n    salesforce:\n      instance_url: {exec: "echo http://127.0.0.1:1"}\n      access_token: {env: MY_TOKEN}\n',
    )
    const query = ['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account LIMIT 1', '--profile', 'dev']
    const out = await runBinary(query, home, {...env(), MY_TOKEN: 'from-env'})
    const body = JSON.parse(out.stdout) as {error: {code: string; message: string}}
    expect(body.error.code).not.toBe('NO_CREDENTIALS')
    expect(body.error.message).toMatch(/ECONNREFUSED|127\.0\.0\.1|connect/i)
    expect(out.stderr).not.toMatch(/readable by others/)

    if (process.platform !== 'win32') {
      await writeConfig('profiles:\n  dev:\n    salesforce:\n      instance_url: http://127.0.0.1:1\n      access_token: literal-secret\n')
      await chmod(join(configHome, dirname, 'config.yaml'), 0o644)
      const readable = await runBinary(query, home, env())
      expect(readable.stderr.match(/readable by others/g)).toHaveLength(1)
      expect((JSON.parse(readable.stdout) as {error: {code: string}}).error.code).not.toBe('NO_CREDENTIALS')
    }
    await writeConfig('')
  }, 60_000)

  it('E-16: two reads perform one login; auth logout forces the next read to log in again', async () => {
    const stub = await startSalesforceStub()
    try {
      await writeConfig(
        `profiles:\n  stub:\n    salesforce:\n      instance_url: ${stub.url}\n      login_url: ${stub.url}\n      username: u@example.com\n      password: pw\n`,
      )
      const cacheEnv = {...env(), XDG_CACHE_HOME: join(home, 'xdg-cache')}
      const query = ['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account LIMIT 1', '--profile', 'stub']
      const first = await runBinary(query, home, cacheEnv)
      expect(first.code, first.stdout + first.stderr).toBe(0)
      expect(JSON.parse(first.stdout)).toMatchObject({success: true})
      const second = await runBinary(query, home, cacheEnv)
      expect(second.code, second.stdout + second.stderr).toBe(0)
      expect(stub.logins).toBe(1)
      expect(stub.queries).toBe(2)

      const status = await runBinary(['auth', 'status'], home, cacheEnv)
      const st = JSON.parse(status.stdout) as {result: {sessions: Array<{provider: string; stateKeys: string[]}>}}
      expect(st.result.sessions).toHaveLength(1)
      expect(st.result.sessions[0]).toMatchObject({provider: 'salesforce', stateKeys: ['accessToken', 'instanceUrl']})
      expect(status.stdout).not.toContain('STUB-SESSION')

      const logout = await runBinary(['auth', 'logout', 'salesforce'], home, cacheEnv)
      expect(JSON.parse(logout.stdout)).toMatchObject({result: {removed: 1}})
      const third = await runBinary(query, home, cacheEnv)
      expect(third.code, third.stdout + third.stderr).toBe(0)
      expect(stub.logins).toBe(2)
    } finally {
      await stub.close()
      await writeConfig('')
    }
  }, 120_000)
})

describe('E-14 canonical names in the standalone binary', () => {
  it('--canonical resolves through an alias file listed in config.yaml; an unknown canonical name exits 2 with JSON', async () => {
    const dir = join(configHome, dirname)
    await mkdir(dir, {recursive: true})
    await writeFile(join(dir, 'two-instance.json'), await readFile('test/fixtures/aliases/two-instance.json', 'utf8'))
    await writeConfig('aliases: [./two-instance.json]\n')
    const ok = await runBinary(['servicenow', 'data', 'query', '--table', 'ticket', '--canonical', '--dry-run'], home, env())
    expect(ok.code, ok.stderr).toBe(0)
    expect(JSON.parse(ok.stdout)).toMatchObject({dryRun: true, wouldExecute: {table: 'incident'}})
    const bad = await runBinary(['servicenow', 'data', 'query', '--table', 'nope', '--canonical', '--dry-run'], home, env())
    expect(bad.code).toBe(2)
    expect(JSON.parse(bad.stdout)).toMatchObject({success: false, error: {code: 'CANONICAL_NOT_FOUND'}})
    const learn = await runBinary(['learn', 'servicenow', '--json'], home, env())
    expect((JSON.parse(learn.stdout) as {canonical_entities: string[]}).canonical_entities).toContain('ticket')
    await writeConfig('')
  }, 60_000)
})
