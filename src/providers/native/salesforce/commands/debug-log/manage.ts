// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args, Flags} from '@oclif/core'
import type {Connection} from 'jsforce'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata} from '../../../../../core/contract/aci.js'

const LOG_LEVELS = ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'FINE', 'FINER', 'FINEST'] as const

/**
 * Manage Salesforce debug logging via the TraceFlag API.
 *
 * Examples:
 *   aclif salesforce debug-log manage enable --username admin@example.com --level DEBUG --duration 60
 *   aclif salesforce debug-log manage disable --username admin@example.com
 *   aclif salesforce debug-log manage retrieve --username admin@example.com --limit 5
 *   aclif salesforce debug-log manage retrieve --log-id 07Lxx000000xxxx --include-body
 */
export default class DebugLogManage extends SalesforceBaseCommand {
  static override description = 'Enable, disable, or retrieve Salesforce debug logs via TraceFlag API'

  static override aciMetadata: AciMetadata = {
    mutability: 'update',
    idempotent: true,
    reversible: true,
    blastRadius: 'single_record',
    apiCallsConsumed: 3,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override args = {
    operation: Args.string({
      description: 'Operation to perform',
      required: true,
      options: ['enable', 'disable', 'retrieve'],
    }),
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    username: Flags.string({description: 'Salesforce username or name to search for', required: true}),
    level: Flags.string({
      description: 'Log level',
      options: [...LOG_LEVELS],
      default: 'DEBUG',
    }),
    duration: Flags.integer({description: 'Duration in minutes (for enable)', default: 30}),
    limit: Flags.integer({description: 'Number of logs to retrieve', default: 10}),
    'log-id': Flags.string({description: 'Specific log ID to retrieve'}),
    'include-body': Flags.boolean({description: 'Include full log content', default: false}),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {args, flags} = await this.parse(DebugLogManage)
    const {operation} = args

    if (this.isDryRun(flags, {operation, username: flags.username})) return

    try {
      const conn = await this.getConnection()

      // Find user
      const userId = await this.findUser(conn, flags.username)
      if (!userId) {
        this.outputError({
          code: 'USER_NOT_FOUND',
          message: `User "${flags.username}" not found`,
          syntaxGuide: 'Use full username (user@org.com) or partial name match',
        })
        return
      }

      switch (operation) {
      case 'enable':
        await this.enableDebugLogs(conn, userId, flags.level!, flags.duration!)
        break
      case 'disable':
        await this.disableDebugLogs(conn, userId)
        break
      case 'retrieve':
        if (flags['log-id']) {
          await this.retrieveSpecificLog(conn, flags['log-id'], flags['include-body'])
        } else {
          await this.retrieveLogs(conn, userId, flags.limit!, flags['include-body'])
        }

        break
      }
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }

  private async findUser(conn: Connection, username: string): Promise<string | null> {
    // Try exact username first
    let result = await conn.query(
      `SELECT Id, Username, Name, IsActive FROM User WHERE Username = '${username}'`,
    )
    if (result.totalSize > 0) {
      return (result.records[0] as {Id: string}).Id
    }

    // Flexible match by name or partial username
    result = await conn.query(
      `SELECT Id, Username, Name, IsActive FROM User WHERE Name LIKE '%${username}%' OR Username LIKE '%${username}%' ORDER BY LastModifiedDate DESC LIMIT 5`,
    )
    if (result.totalSize > 0) {
      return (result.records[0] as {Id: string}).Id
    }

    return null
  }

  private async enableDebugLogs(conn: Connection, userId: string, level: string, durationMinutes: number): Promise<void> {
    const expirationDate = new Date(Date.now() + durationMinutes * 60 * 1000)

    // Check for existing active trace flag
    const existing = await conn.tooling.query(
      `SELECT Id, DebugLevelId FROM TraceFlag WHERE TracedEntityId = '${userId}' AND ExpirationDate > ${new Date().toISOString()}`,
    )

    // Create debug level
    const debugLevelResult = await conn.tooling.sobject('DebugLevel').create({
      DeveloperName: `UserDebug_${Date.now()}`,
      MasterLabel: `User Debug ${userId.slice(0, 8)}`,
      ApexCode: level,
      ApexProfiling: level,
      Callout: level,
      Database: level,
      System: level,
      Validation: level,
      Visualforce: level,
      Workflow: level,
    })

    if (!debugLevelResult.success) {
      this.outputError({code: 'DEBUG_LEVEL_FAILED', message: `Failed to create debug level`})
      return
    }

    if (existing.totalSize > 0) {
      // Update existing trace flag
      const traceFlagId = (existing.records[0] as {Id: string}).Id
      await conn.tooling.sobject('TraceFlag').update({
        Id: traceFlagId,
        DebugLevelId: debugLevelResult.id,
        ExpirationDate: expirationDate.toISOString(),
      })

      this.outputResult({
        operation: 'enable',
        status: 'Updated existing trace flag',
        traceFlagId,
        debugLevelId: debugLevelResult.id,
        level,
        expiresAt: expirationDate.toISOString(),
      })
    } else {
      // Create new trace flag
      const traceFlagResult = await conn.tooling.sobject('TraceFlag').create({
        TracedEntityId: userId,
        DebugLevelId: debugLevelResult.id,
        LogType: 'USER_DEBUG',
        StartDate: new Date().toISOString(),
        ExpirationDate: expirationDate.toISOString(),
      })

      if (traceFlagResult.success) {
        this.outputResult({
          operation: 'enable',
          status: 'Created',
          traceFlagId: traceFlagResult.id,
          debugLevelId: debugLevelResult.id,
          level,
          expiresAt: expirationDate.toISOString(),
        })
      } else {
        this.outputError({code: 'TRACE_FLAG_FAILED', message: `Failed to create trace flag`})
      }
    }
  }

  private async disableDebugLogs(conn: Connection, userId: string): Promise<void> {
    const traceFlags = await conn.tooling.query(
      `SELECT Id FROM TraceFlag WHERE TracedEntityId = '${userId}' AND ExpirationDate > ${new Date().toISOString()}`,
    )

    if (traceFlags.totalSize === 0) {
      this.outputResult({operation: 'disable', status: 'No active trace flags found'})
      return
    }

    const results: Array<{id: string; status: string}> = []
    for (const record of traceFlags.records) {
      const id = (record as {Id: string}).Id
      try {
        await conn.tooling.sobject('TraceFlag').delete(id)
        results.push({id, status: 'Deleted'})
      } catch {
        // Fallback: set expiration to near future
        try {
          const nearFuture = new Date(Date.now() + 5 * 60 * 1000)
          await conn.tooling.sobject('TraceFlag').update({
            Id: id,
            ExpirationDate: nearFuture.toISOString(),
          })
          results.push({id, status: 'Expiration set to 5 minutes'})
        } catch (updateError) {
          results.push({id, status: `Error: ${(updateError as Error).message}`})
        }
      }
    }

    this.outputResult({operation: 'disable', traceFlags: results})
  }

  private async retrieveLogs(conn: Connection, userId: string, limit: number, includeBody: boolean): Promise<void> {
    const logs = await conn.tooling.query(
      `SELECT Id, LogUserId, Operation, Application, Status, LogLength, LastModifiedDate, Request FROM ApexLog WHERE LogUserId = '${userId}' ORDER BY LastModifiedDate DESC LIMIT ${limit}`,
    )

    const records = logs.records as Array<Record<string, unknown>>

    if (includeBody && records.length > 0) {
      // Fetch body for the most recent log
      const logId = records[0].Id as string
      const body = await this.fetchLogBody(conn, logId)
      records[0].Body = body
    }

    this.outputResult({
      totalLogs: logs.totalSize,
      logs: records,
    }, this.buildContext({
      returned: records.length,
      total: logs.totalSize,
      relatedCommands: records.length > 0
        ? [`$BIN salesforce debug-log manage retrieve --log-id ${records[0].Id} --include-body`]
        : [],
    }))
  }

  private async retrieveSpecificLog(conn: Connection, logId: string, includeBody: boolean): Promise<void> {
    const log = await conn.tooling.query(
      `SELECT Id, LogUserId, Operation, Application, Status, LogLength, LastModifiedDate FROM ApexLog WHERE Id = '${logId}'`,
    )

    if (log.totalSize === 0) {
      this.outputError({code: 'NOT_FOUND', message: `Log "${logId}" not found`})
      return
    }

    const record = log.records[0] as Record<string, unknown>

    if (includeBody) {
      record.Body = await this.fetchLogBody(conn, logId)
    }

    this.outputResult(record)
  }

  private async fetchLogBody(conn: Connection, logId: string): Promise<string> {
    try {
      const response = await conn.tooling.request({
        method: 'GET',
        url: `${conn.instanceUrl}/services/data/v59.0/tooling/sobjects/ApexLog/${logId}/Body`,
      })
      return response as string
    } catch (error) {
      return `[Error fetching log body: ${(error as Error).message}]`
    }
  }
}
