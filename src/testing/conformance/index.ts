// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * The conformance suite as a library. The framework's own tests call it
 * over the built-in registry; a CLI package built on the framework calls it
 * over its registry and checks the providers it declares itself.
 *
 *   import {conformanceSuite} from 'aclif/testing'
 *   import {registry} from '../src/index.js'
 *   conformanceSuite({registry, cliRoot: process.cwd(), sourceDirs: [{dir: 'src/providers', tier: 'private'}], dependencyAllowlist: 'src/providers/dependency-allowlist.json'})
 *
 * Every rule id (C-META-1, C-CRED-2, ...) is documented in the framework's
 * docs/PROVIDER_AUTHORING.md.
 */
import {behaviorSuite} from './behavior.js'
import {catalogSuite} from './catalog.js'
import type {ConformanceOptions} from './options.js'
import {sourceSuite} from './source.js'
import {tenantSuite} from './tenant.js'

export type {ConformanceOptions, RecordingFake, SourceDir} from './options.js'
export {behaviorSuite, catalogSuite, sourceSuite, tenantSuite}

/** Register every conformance rule as vitest tests. Call from a test file. */
export function conformanceSuite(opts: ConformanceOptions): void {
  catalogSuite(opts)
  sourceSuite(opts)
  behaviorSuite(opts)
  tenantSuite(opts)
}
