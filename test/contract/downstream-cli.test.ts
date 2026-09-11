import {execFileSync} from 'node:child_process'
import {mkdtemp, readFile, rm, writeFile, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {runBinary} from '../../scripts/capture-golden.js'

/**
 * K-11: a CLI package built on the framework. Scaffold one named mycli,
 * install the packed framework into it, build it, and run it: it must
 * carry its own name (bin, config dir, rendered examples, scoped env
 * variables) and only the providers it chose. Per-test timeouts are generous:
 * a freshly installed package on a Windows runner loads slowly on first use.
 */
const RUN = process.env.ACLIF_DOWNSTREAM_TEST !== '0'
let work: string
let cli: string

beforeAll(async () => {
  if (!RUN) return
  work = await mkdtemp(join(tmpdir(), 'aclif-downstream-'))
  // Pack without lifecycle scripts: prepack would delete and rebuild lib/
  // while other test files run against it, and generating a manifest in
  // the repo root races the e2e binaries. The build already exists and the
  // downstream package does not need the framework's manifest.
  const sh = process.platform === 'win32'
  const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', work, '--silent'], {encoding: 'utf8', shell: sh}).trim().split('\n').pop()!
  cli = join(work, 'mycli')
  execFileSync(process.execPath, ['scripts/scaffold-cli.mjs', '--name', 'mycli', '--dir', cli, '--providers', 'salesforce,servicenow', '--aclif', `file:${join(work, packed)}`], {encoding: 'utf8'})
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent'], {cwd: cli, encoding: 'utf8', shell: process.platform === 'win32'})
  execFileSync('npm', ['run', 'build', '--silent'], {cwd: cli, encoding: 'utf8', shell: process.platform === 'win32'})
}, 600_000)
afterAll(async () => {
  // A freshly installed node_modules tree takes a while to delete on Windows.
  if (work) await rm(work, {recursive: true, force: true, maxRetries: 5})
}, 300_000)

const run = (argv: string[], extra: NodeJS.ProcessEnv = {}) =>
  runBinary(argv, join(work, 'home'), extra, join(cli, 'bin', 'run.js'))

describe.skipIf(!RUN)('K-11 downstream CLI built on the framework', () => {
  it('ships only its chosen providers, as its own tier', async () => {
    const out = await run(['discover', '--json'])
    expect(out.code, out.stderr).toBe(0)
    const body = JSON.parse(out.stdout) as {providers: Array<{name: string; tier: string}>}
    expect(body.providers.map((p) => [p.name, p.tier])).toEqual([['salesforce', 'private'], ['servicenow', 'private']])
  }, 300_000)

  it('renders its own name in examples and reads its scoped env variables', async () => {
    const ex = await run(['salesforce', 'data', 'query', '--examples'])
    expect(ex.code, ex.stderr).toBe(0)
    expect(ex.stdout).toContain('mycli salesforce data query')
    expect(ex.stdout).not.toContain('aclif salesforce')

    const cfg = join(work, 'xdg', 'mycli')
    await mkdir(cfg, {recursive: true})
    await writeFile(join(cfg, 'config.yaml'), 'profiles:\n  dev:\n    servicenow:\n      instance_url: https://sn.example.com\n      access_token: t\n')
    const status = await run(['auth', 'status'], {XDG_CONFIG_HOME: join(work, 'xdg'), MYCLI_PROFILE: 'dev'})
    expect(status.code, status.stderr).toBe(0)
    const st = JSON.parse(status.stdout) as {result: {profile: string; configFile: string}}
    expect(st.result.profile).toBe('dev')
    expect(st.result.configFile).toContain(join('xdg', 'mycli'))
    const learn = await run(['learn', 'servicenow', '--json'], {XDG_CONFIG_HOME: join(work, 'xdg'), MYCLI_PROFILE: 'dev'})
    expect((JSON.parse(learn.stdout) as {auth_status: string}).auth_status).toMatch(/^configured/)
  }, 300_000)

  it('hooks run in the downstream binary: audit line on stderr', async () => {
    const out = await run(['discover', '--json'])
    expect(out.stderr).toMatch(/\[AUDIT\] .*"command":"discover"/)
    expect(await readFile(join(cli, 'package.json'), 'utf8')).toContain('"salesforce:data"')
  }, 300_000)
})
