// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {ServiceNowBaseCommand} from '../../base.js'
import type {AciMetadata} from '../../../../../core/contract/aci.js'

/**
 * Execute a ServiceNow background script via the Scripted REST API or Table API.
 * Submits server-side JavaScript to run in the ServiceNow instance.
 *
 * Examples:
 *   aclif servicenow script run --code "gs.info('Hello from background script')"
 *   aclif servicenow script run --code "var gr = new GlideRecord('incident'); gr.addQuery('active', true); gr.query(); gs.info('Active incidents: ' + gr.getRowCount())"
 */
export default class ScriptRun extends ServiceNowBaseCommand {
  static override description = 'Execute a ServiceNow background script'

  static override aciMetadata: AciMetadata = {
    mutability: 'update',
    idempotent: false,
    reversible: false,
    blastRadius: 'all_records',
    apiCallsConsumed: 1,
    requiresConfirmation: true,
    prerequisites: ['admin role or script execution permissions'],
    capabilities: ['code_exec'],
  }

  static override flags = {
    ...ServiceNowBaseCommand.baseFlags,
    code: Flags.string({
      description: 'JavaScript code to execute as a background script',
      required: true,
      char: 'c',
    }),
    scope: Flags.string({
      description: 'Application scope (default: global)',
      default: 'global',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(ScriptRun)

    if (this.isDryRun(flags, {code: flags.code, scope: flags.scope})) return

    try {
      const client = await this.getConnection()

      // Create a sys_script_execution record to run the background script
      // This uses the standard Table API approach for script execution
      const result = await client.tableCreate('sys_script_execution', {
        script: flags.code,
        scope: flags.scope,
      })

      this.outputResult({
        executed: true,
        scope: flags.scope,
        code: flags.code,
        result: result.result,
      }, this.buildContext({
        refinements: [
          'Background scripts run with the authenticated user\'s permissions',
          'Use gs.info() to output messages; check System Logs for output',
        ],
      }))
    } catch (error) {
      // If sys_script_execution is not available, provide guidance
      const errMsg = error instanceof Error ? error.message : String(error)
      if (errMsg.includes('no resource found') || errMsg.includes('(404)')) {
        this.outputError({
          code: 'SCRIPT_API_UNAVAILABLE',
          message: 'Background script execution API is not available on this instance. Ensure you have admin access and the Scripted REST API is enabled.',
          syntaxGuide: 'Alternative: Use the ServiceNow UI at /sys.scripts.do to run background scripts',
        })
      } else {
        this.outputError(this.formatError(error))
      }
    }
  }
}
