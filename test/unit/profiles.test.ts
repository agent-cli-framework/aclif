import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
  applyProfileToEnv,
  ConfigError,
  loadConfigFile,
  resolvePolicy,
  selectProfile,
} from '../../src/cli/config/profiles.js'
import {getRegistry} from '../../src/providers/index.js'

const schemas = Object.fromEntries(getRegistry().entries().map((e) => [e.plugin.name, e.plugin.credentials]))

describe('U-CFG-1 profiles loader', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aclif-cfg-'))
  })
  afterEach(async () => {
    await rm(dir, {recursive: true, force: true})
  })
  const write = (text: string) => writeFile(join(dir, 'config.yaml'), text)

  it('missing file is not an error and selects no profile', () => {
    const loaded = loadConfigFile(dir)
    expect(loaded.exists).toBe(false)
    expect(selectProfile(loaded)).toBeUndefined()
    expect(resolvePolicy(loaded.config.policy)).toMatchObject({require_identity: false})
  })

  it('malformed YAML and a non-mapping top level are ConfigErrors naming the file', async () => {
    await write('profiles: [unclosed')
    expect(() => loadConfigFile(dir)).toThrow(ConfigError)
    await write('- a\n- b\n')
    expect(() => loadConfigFile(dir)).toThrow(/top level must be a mapping/)
  })

  it('default_profile applies and --profile overrides it; unknown profile errors clearly', async () => {
    await write('default_profile: dev\nprofiles:\n  dev:\n    salesforce: {username: dev@example.com}\n  prod:\n    salesforce: {username: prod@example.com}\n')
    const loaded = loadConfigFile(dir)
    expect(selectProfile(loaded)?.name).toBe('dev')
    expect(selectProfile(loaded, 'prod')?.profile.salesforce.username).toBe('prod@example.com')
    expect(() => selectProfile(loaded, 'missing')).toThrow(/Profile 'missing' not found .*available: dev, prod/)
  })

  it('applies known provider fields to the environment without overriding, and warns on unknown keys', () => {
    const env: NodeJS.ProcessEnv = {SF_USERNAME: 'already-set'}
    const warnings = applyProfileToEnv(
      'dev',
      {
        salesforce: {username: 'dev@example.com', password: 'pw', bogus_field: 'x'},
        servicenow: {instance_url: 'https://sn.example.com'},
        google: {client_id: 'c'},
        notaprovider: {a: 'b'},
      },
      schemas,
      env,
    )
    expect(env.SF_USERNAME).toBe('already-set')
    expect(env.SF_PASSWORD).toBe('pw')
    expect(env.SN_INSTANCE_URL).toBe('https://sn.example.com')
    expect(warnings.some((w) => w.includes("unknown provider 'notaprovider'"))).toBe(true)
    expect(warnings.some((w) => w.includes("unknown field 'bogus_field'"))).toBe(true)
    expect(env.GW_CLIENT_ID).toBe('c')
  })

  it('validates the policy section', () => {
    expect(resolvePolicy({require_identity: true, require_confirm_for: ['delete', 'code_exec']})).toMatchObject({
      require_identity: true,
      require_confirm_for: ['delete', 'code_exec'],
      dry_run_warning_for: ['filtered_set', 'all_records'],
    })
    expect(() => resolvePolicy({require_identity: 'yes'})).toThrow(ConfigError)
    expect(() => resolvePolicy({require_confirm_for: ['explode']})).toThrow(/allowed:/)
    expect(() => resolvePolicy({dry_run_warning_for: 'all_records'})).toThrow(/list of strings/)
  })

  it('rejects an unknown identity provider', async () => {
    await write('identity:\n  provider: okta\n')
    expect(() => loadConfigFile(dir)).toThrow(/identity.provider 'okta'/)
  })
})
