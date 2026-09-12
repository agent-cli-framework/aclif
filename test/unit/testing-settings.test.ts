// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {settings} from '@oclif/core'
import {describe, expect, it} from 'vitest'

import '../../src/testing/run.js'

/**
 * A downstream CLI package runs the conformance suite and golden check
 * against its compiled lib/. Importing the testing library must switch off
 * oclif's lib-to-src mapping, or a package without tsx fails at
 * Config.load with "Unknown file extension .ts" once NODE_ENV is "test".
 */
describe('aclif/testing runs the compiled package', () => {
  it('turns off oclif auto-transpile on import', () => {
    expect(settings.enableAutoTranspile).toBe(false)
    expect(settings.tsnodeEnabled).toBe(false)
  })
})
