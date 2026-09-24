import {spawn} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {CONTRACT_VERSION} from '../../src/core/contract/version.js'
import {cleanEnv, runBinary} from '../../scripts/capture-golden.js'
import {assertEnvelope} from '../helpers/envelope.js'
import {startSalesforceStub} from '../helpers/salesforce-stub.js'

/**
 * End-to-end rows through the built binary: E-2, E-5, E-6, E-7, E-9, E-12,
 * with every envelope checked against schemas/envelope.schema.json (K-2).
 */
let home: string
let configHome: string
let dirname: string
let bin: string

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
  home = await mkdtemp(join(tmpdir(), 'aclif-e2e5-'))
  configHome = join(home, 'xdg-config')
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {oclif: {dirname: string; bin: string}}
  dirname = pkg.oclif.dirname
  bin = pkg.oclif.bin
})
afterAll(async () => {
  await rm(home, {recursive: true, force: true})
})
const env = (extra: NodeJS.ProcessEnv = {}) => ({XDG_CONFIG_HOME: configHome, ...extra})

describe('standalone binary, envelope and exit codes', () => {
  it('E-2: learn <provider> with an empty environment exits 0 with the briefing', async () => {
    const out = await runBinary(['learn', 'salesforce', '--json'], home, env())
    expect(out.code, out.stderr).toBe(0)
    const body = JSON.parse(out.stdout) as {provider: string; auth_status: string; auth_paths: string[]}
    expect(body.provider).toBe('salesforce')
    expect(body.auth_status).toBe('not configured')
    expect(body.auth_paths.length).toBeGreaterThan(0)
    expect(out.stdout).not.toContain('$BIN')
  }, 60_000)

  it('E-12: version --json carries the package version, the contract version, and the bin name', async () => {
    const out = await runBinary(['version', '--json'], home, env())
    expect(out.code, out.stderr).toBe(0)
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {version: string}
    expect(JSON.parse(out.stdout)).toMatchObject({bin, version: pkg.version, contract: CONTRACT_VERSION, framework: {name: 'aclif', version: pkg.version}})
  }, 60_000)

  it('help renders $BIN as the bin name in topic listings and command pages', async () => {
    for (const argv of [['docusign', '--help'], ['docusign', 'discover', '--help']]) {
      const out = await runBinary(argv, home, env())
      expect(out.code, out.stderr).toBe(0)
      expect(out.stdout).toContain(`exposed by ${bin}`)
      expect(out.stdout).not.toContain('$BIN')
    }
  }, 60_000)

  it('E-6: an unknown flag exits 2 with a JSON error on stdout and an audit line carrying the code', async () => {
    const out = await runBinary(['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account', '--bogus'], home, env())
    expect(out.code).toBe(2)
    const body = assertEnvelope(JSON.parse(out.stdout))
    expect(body.error).toMatchObject({code: 'INVALID_USAGE', message: 'Nonexistent flag: --bogus'})
    expect((body.error as unknown as {syntaxGuide: string}).syntaxGuide).toContain(`${bin} salesforce data query --schema --json`)
    expect(out.stderr).not.toMatch(/^USAGE$/m)
    expect(audit(out.stderr)).toMatchObject({command: 'salesforce:data:query', exitCode: 2})

    const missing = await runBinary(['salesforce', 'data', 'query'], home, env())
    expect(missing.code).toBe(2)
    expect(assertEnvelope(JSON.parse(missing.stdout)).error).toMatchObject({code: 'INVALID_USAGE', message: 'Missing required flag query'})

    const badValue = await runBinary(['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account', '--limit', 'x'], home, env())
    expect(badValue.code).toBe(2)
    expect(assertEnvelope(JSON.parse(badValue.stdout)).error).toMatchObject({code: 'INVALID_USAGE', message: '--limit: Expected an integer but received: x'})
    expect(badValue.stderr).not.toContain('See more help')
    expect(audit(badValue.stderr)).toMatchObject({command: 'salesforce:data:query', exitCode: 2})
  }, 60_000)

  it('E-5: a read against an unreachable instance exits 1 with a COMMAND_ERROR envelope and an audit line with the error code', async () => {
    const out = await runBinary(
      ['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account LIMIT 1'],
      home,
      env({SF_INSTANCE_URL: 'http://127.0.0.1:1', SF_ACCESS_TOKEN: 'not-a-token'}),
    )
    expect(out.code).toBe(1)
    const body = assertEnvelope(JSON.parse(out.stdout))
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('COMMAND_ERROR')
    expect(body.error?.message).toMatch(/ECONNREFUSED|127\.0\.0\.1|connect/i)
    expect(audit(out.stderr)).toMatchObject({command: 'salesforce:data:query', exitCode: 1, error: {code: 'COMMAND_ERROR'}})
  }, 120_000)

  it('E-7: --pretty produces colored output when color is forced; --json is parseable', async () => {
    const pretty = await runBinary(['auth', 'status', '--pretty'], home, env({FORCE_COLOR: '1'}))
    expect(pretty.code, pretty.stderr).toBe(0)
    expect(pretty.stdout).toContain('[')
    const plain = await runBinary(['auth', 'status', '--json'], home, env())
    expect(plain.stdout).not.toContain('[')
    const body = assertEnvelope(JSON.parse(plain.stdout))
    expect(body.success).toBe(true)
    expect(body._context).toMatchObject({contract: CONTRACT_VERSION})
  }, 60_000)

  it.skipIf(process.platform === 'win32')('E-9: SIGINT during a stubbed mutation exits 130 with a warning JSON line on stderr', async () => {
    const stub = await startSalesforceStub()
    try {
      await writeConfig(`profiles:\n  stub:\n    salesforce:\n      instance_url: ${stub.url}\n      login_url: ${stub.url}\n      username: u@example.com\n      password: pw\n`)
      const child = spawn(
        process.execPath,
        [join('bin', 'run.js'), 'salesforce', 'data', 'dml', 'insert', 'Account', '--values', '{"Name":"Interrupted"}', '--profile', 'stub'],
        {cwd: process.cwd(), env: cleanEnv(home, env({XDG_CACHE_HOME: join(home, 'xdg-cache')})), stdio: ['ignore', 'pipe', 'pipe']},
      )
      let stderr = ''
      let stdout = ''
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString()
      })
      const exited = new Promise<number | null>((resolve) => child.on('close', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : null))))
      await stub.mutationStarted
      child.kill('SIGINT')
      const code = await exited
      expect(code, stdout + stderr).toBe(130)
      const warning = stderr.split('\n').find((l) => l.startsWith('{"warning"'))
      expect(warning, stderr).toBeDefined()
      expect(JSON.parse(warning!)).toMatchObject({warning: 'SIGINT received during mutation operation', command: 'salesforce:data:dml', mutability: 'create'})
      expect(stub.mutations).toBe(1)
    } finally {
      await stub.close()
      await writeConfig('')
    }
  }, 120_000)
})
