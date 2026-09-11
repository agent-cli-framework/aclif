// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {createRequire} from 'node:module'

import type {AciMetadata, ResponseShape} from '../../core/contract/aci.js'
import {CONTRACT_VERSION} from '../../core/contract/version.js'
import {AciBaseCommand} from '../base-command.js'

const frameworkVersion = (createRequire(import.meta.url)('../../../package.json') as {version: string}).version

/**
 * Version of the CLI artifact, of the framework it was built with, and of
 * the agent-facing contract. oclif answers `--version` with a one-line
 * user agent before any command loads, so the JSON form is a command.
 *
 * Examples:
 *   $BIN version --json
 */
export default class Version extends AciBaseCommand {
  static override description = 'Package, framework, and contract versions as JSON'

  static override flags = {
    ...AciBaseCommand.baseFlags,
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 0,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: 'Versions of the CLI, the framework, and the contract',
    fields: {
      bin: {type: 'string', description: 'binary name of this CLI'},
      version: {type: 'string', description: 'version of the CLI package'},
      contract: {type: 'string', description: 'contract version the envelope and schemas conform to'},
      framework: {type: 'object', description: '{name, version} of aclif'},
      node: {type: 'string', description: 'Node.js version'},
      platform: {type: 'string', description: 'process.platform'},
      arch: {type: 'string', description: 'process.arch'},
    },
    example: {
      bin: 'aclif',
      version: '0.1.0',
      contract: CONTRACT_VERSION,
      framework: {name: 'aclif', version: '0.1.0'},
      node: 'v22.0.0',
      platform: 'linux',
      arch: 'x64',
    },
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.log(JSON.stringify({
      bin: this.config.bin,
      version: this.config.version,
      contract: CONTRACT_VERSION,
      framework: {name: 'aclif', version: frameworkVersion},
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    }, null, 2))
  }
}
