/**
 * The framework's own conformance options: the built-in registry over the
 * three tier directories, with the fakes for the built-in providers. Each
 * conformance test file passes these to one suite from `src/testing`.
 */
import {resolve} from 'node:path'

import {builtinRegistry} from '../../src/providers/index.js'
import type {ConformanceOptions} from '../../src/testing/index.js'
// @ts-expect-error eslint.config.js ships no type declarations
import eslintConfig from '../../eslint.config.js'
import {HTTP_FAKES, NO_CLIENT, READ_ONLY_MEMBERS, SESSION_FAKES, TENANT_FAKES} from './fakes.js'

export const frameworkOptions: ConformanceOptions = {
  registry: builtinRegistry(),
  cliRoot: process.cwd(),
  sourceDirs: [
    {dir: 'src/providers/native', tier: 'native'},
    {dir: 'src/providers/contributed', tier: 'contributed'},
    {dir: 'src/providers/private', tier: 'private'},
  ],
  dependencyAllowlist: 'src/providers/dependency-allowlist.json',
  privateDependencyAllowlist: 'src/providers/private/dependency-allowlist.json',
  codeowners: '.github/CODEOWNERS',
  manifestFixtures: 'test/fixtures/manifests',
  frameworkSrc: resolve('src'),
  eslintConfig,
  noClient: NO_CLIENT,
  tenantFakes: TENANT_FAKES,
  readOnlyMembers: READ_ONLY_MEMBERS,
  httpFakes: HTTP_FAKES,
  sessionFakes: SESSION_FAKES,
}
