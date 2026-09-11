// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, ResponseShape} from '../../../../../core/contract/aci.js'

export default class ApexRun extends SalesforceBaseCommand {
  static override description = 'Execute anonymous Apex code'

  static override aciExamples: CommandExample[] = [
    {description: 'Debug output', command: '$BIN salesforce apex run --code "System.debug(\'Hello World\');" --confirm'},
    {description: 'Query in Apex', command: '$BIN salesforce apex run --code "List<Account> accts = [SELECT Id, Name FROM Account LIMIT 5]; System.debug(accts);" --confirm'},
  ]

  static override responseShape: ResponseShape = {
    description: 'Apex execution result with compile/runtime status',
    fields: {
      success: {type: 'boolean', description: 'Whether execution succeeded'},
      compiled: {type: 'boolean', description: 'Whether code compiled successfully'},
      compileProblem: {type: 'string', nullable: true, description: 'Compilation error if any'},
      exceptionMessage: {type: 'string', nullable: true, description: 'Runtime exception if any'},
    },
    example: {success: true, compiled: true, executed: true},
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'update',
    idempotent: false,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 1,
    requiresConfirmation: true,
    prerequisites: [],
    capabilities: ['code_exec'],
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    code: Flags.string({
      description: 'Apex code to execute',
      required: true,
      char: 'c',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(ApexRun)

    if (this.isDryRun(flags, {code: flags.code})) return

    try {
      const conn = await this.getConnection()
      const result = await conn.tooling.executeAnonymous(flags.code) as Record<string, unknown>

      if (result.success) {
        this.outputResult({
          success: true,
          compiled: result.compiled,
          executed: true,
          logs: result.exceptionMessage ? undefined : 'Check debug logs for output',
        })
      } else {
        const error: Record<string, unknown> = {
          success: false,
          compiled: result.compiled,
        }
        if (!result.compiled) {
          error.compileProblem = result.compileProblem
          error.line = result.line
          error.column = result.column
        }
        if (result.exceptionMessage) {
          error.exceptionMessage = result.exceptionMessage
          error.exceptionStackTrace = result.exceptionStackTrace
        }
        this.outputResult(error)
      }
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
