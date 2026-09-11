// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Per-process context the hooks resolve once and every command can read:
 * the identity, the policy in force, and where the config file was found.
 * Attached to the oclif Config under one documented key.
 */
import type {Interfaces} from '@oclif/core'

import type {Identity} from './identity/identity.js'
import type {Policy} from './policy/policy.js'

export const COMMAND_CONTEXT_KEY = 'aclif'

export interface CommandContext {
  identity?: Identity
  identityProvider: string
  policy: Policy
  /** Absolute path of the config file that was read, when one existed. */
  configFile?: string
  /** Name of the profile applied to the environment, when one was selected. */
  profile?: string
}

// oclif's Command.run() re-loads the Config it is handed and constructs the
// command with a new object, so a value attached to the hooks' Config never
// reaches the command. The process-level copy below is the one commands
// actually read; the Config attachment is kept for hosts that pass one
// Config object through by hand. A process runs one standalone command, and
// embedded hosts never run the hooks, so the process-level copy is safe.
let processContext: CommandContext | undefined

export function getCommandContext(config: Interfaces.Config): CommandContext | undefined {
  return ((config as unknown as Record<string, unknown>)[COMMAND_CONTEXT_KEY] as CommandContext | undefined) ?? processContext
}

export function setCommandContext(config: Interfaces.Config, context: CommandContext): void {
  ;(config as unknown as Record<string, unknown>)[COMMAND_CONTEXT_KEY] = context
  processContext = context
}

/** Test hook: forget the process-level context and, when given, the copy attached to a Config. */
export function resetCommandContext(config?: Interfaces.Config): void {
  processContext = undefined
  if (config) delete (config as unknown as Record<string, unknown>)[COMMAND_CONTEXT_KEY]
}
