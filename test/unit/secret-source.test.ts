import {chmod, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {applyProfileToEnv} from '../../src/cli/config/profiles.js'
import {isSecretSourceObject, resolveSecretSource} from '../../src/core/credentials/secret-source.js'
import {getRegistry} from '../../src/providers/index.js'

const schemas = Object.fromEntries(getRegistry().entries().map((e) => [e.plugin.name, e.plugin.credentials]))
let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aclif-secrets-'))
  await writeFile(join(dir, 'token.txt'), 'file-token\n')
})
afterAll(async () => {
  await rm(dir, {recursive: true, force: true})
})

describe('U-CFG-2 secret sources', () => {
  it('recognises the three source shapes and nothing else', () => {
    expect(isSecretSourceObject({env: 'X'})).toBe(true)
    expect(isSecretSourceObject({file: 'x'})).toBe(true)
    expect(isSecretSourceObject({exec: 'x'})).toBe(true)
    expect(isSecretSourceObject({env: 'X', file: 'y'})).toBe(false)
    expect(isSecretSourceObject({vault: 'x'})).toBe(false)
    expect(isSecretSourceObject('literal')).toBe(false)
  })

  it('{env} resolves and errors clearly when unset', () => {
    expect(resolveSecretSource({env: 'T'}, {env: {T: 'v'}})).toBe('v')
    expect(() => resolveSecretSource({env: 'T'}, {env: {}})).toThrow(/environment variable T is not set/)
  })

  it('{file} reads and trims one trailing newline; a missing file names the source, not the path contents', () => {
    expect(resolveSecretSource({file: 'token.txt'}, {cwd: dir})).toBe('file-token')
    expect(() => resolveSecretSource({file: 'nope.txt'}, {cwd: dir})).toThrow(/cannot read secret file for \{file: nope.txt\}: ENOENT/)
  })

  it('{exec} captures stdout, reports non-zero exit and timeouts', () => {
    expect(resolveSecretSource({exec: 'echo exec-token'})).toBe('exec-token')
    expect(() => resolveSecretSource({exec: 'exit 3'})).toThrow(/exited 3/)
    const nodeSleep = `"${process.execPath}" -e "setTimeout(()=>{},5000)"`
    expect(() => resolveSecretSource({exec: nodeSleep}, {timeoutMs: 200})).toThrow(/timed out/)
  })

  it('applyProfileToEnv resolves sources, keeps flag > env precedence, and warns once on a readable literal secret', async () => {
    const env: NodeJS.ProcessEnv = {MY_TOKEN: 'from-env', SF_USERNAME: 'already'}
    const warnings = applyProfileToEnv(
      'dev',
      {salesforce: {instance_url: {exec: 'echo https://x'}, access_token: {env: 'MY_TOKEN'}, username: 'ignored', password: 'literal', security_token: 'literal2', client_secret: {vault: 'x'} as never}},
      schemas,
      env,
      {fileMode: 0o644},
    )
    expect(env.SF_INSTANCE_URL).toBe('https://x')
    expect(env.SF_ACCESS_TOKEN).toBe('from-env')
    expect(env.SF_USERNAME).toBe('already')
    expect(env.SF_PASSWORD).toBe('literal')
    expect(warnings.filter((w) => w.includes('readable by others'))).toHaveLength(1)
    expect(warnings.some((w) => w.includes('client_secret') && w.includes('must be a string or one of'))).toBe(true)
    expect(applyProfileToEnv('dev', {salesforce: {password: 'literal'}}, schemas, {}, {fileMode: 0o600})).toEqual([])
    expect(applyProfileToEnv('dev', {salesforce: {password: {env: 'UNSET'}}}, schemas, {}, {})[0]).toMatch(/salesforce\.password: environment variable UNSET is not set/)
  })
})
