// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {Hook} from '@oclif/core'

import {ensureCommandContext} from '../context.js'
import {ConfigError} from '../config/profiles.js'
import {isPolicyExempt} from '../../core/policy/policy.js'
import {applyScopedEnv} from '../env.js'
import {installSigintHandler} from '../sigint-handler.js'

/**
 * init hook: SIGINT handling and identity resolution.
 *
 * Reads the config file, resolves identity through the configured provider
 * (anonymous unless the file says otherwise), and stores the CommandContext
 * for prerun, finally, and commands. A presented token that fails
 * verification is an error here, not a silent fallback to anonymous.
 */
const hook: Hook<'init'> = async function (opts) {
  installSigintHandler()
  applyScopedEnv(this.config.bin)
  if (isPolicyExempt(opts.id)) return
  try {
    await ensureCommandContext(this.config, opts.argv, (m) => this.warn(m))
  } catch (err) {
    this.error((err as Error).message, {exit: err instanceof ConfigError ? 2 : 3})
  }
}

export default hook
