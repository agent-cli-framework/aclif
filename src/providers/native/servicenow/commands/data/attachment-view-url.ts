// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {ServiceNowBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

/**
 * Build the deterministic ServiceNow web-UI URL for an attachment.
 *
 * No API call — formatted from the configured instance URL and the
 * attachment sys_id. Mirrors `docusign envelopes view-url`. Used by
 * the agent's knowledge watcher to populate the user-facing
 * click-through URL on table-column documents whose bytes are fetched
 * via the gateway content-fetch route.
 */
export default class DataAttachmentViewUrl extends ServiceNowBaseCommand {
  static override description =
    'Build the ServiceNow web-UI URL for an attachment by sys_id (deterministic — no API call)'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Get a click-through URL for an attachment',
      command: '$BIN servicenow data attachment-view-url --sys-id abc123 --json',
      responseShape: {
        sysId: 'abc123',
        url: 'https://dev12345.service-now.com/sys_attachment.do?sys_id=abc123&view=true',
      },
    },
  ]

  static override responseShape: ResponseShape = {
    description:
      'Deterministic web-UI URL that opens the attachment in the user\'s ' +
      'ServiceNow session. No API call is made — the URL is formatted ' +
      'from the connection\'s instance URL and the supplied sys_id. ' +
      'The user must have their own ServiceNow account with read access ' +
      'to the attachment for the link to render bytes.',
    fields: {
      sysId: {type: 'string', description: 'Echo of the attachment sys_id'},
      url: {type: 'string', description: 'sys_attachment.do view URL'},
    },
    example: {
      sysId: 'abc123',
      url: 'https://dev12345.service-now.com/sys_attachment.do?sys_id=abc123&view=true',
    },
  }

  static override flagCategories: FlagCategorization = {
    'sys-id': ['filtering'],
    json: ['output'],
    'instance-url': ['auth'],
    'access-token': ['auth'],
    'sn-username': ['auth'],
    'sn-password': ['auth'],
    'service-account': ['auth'],
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

  static override flags = {
    ...ServiceNowBaseCommand.baseFlags,
    'sys-id': Flags.string({
      description: 'Attachment sys_id',
      required: true,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(DataAttachmentViewUrl)

    try {
      const client = await this.getConnection()
      const sysId = flags['sys-id']
      const url = `${client.instanceUrl}/sys_attachment.do?sys_id=${encodeURIComponent(sysId)}&view=true`

      await this.outputResult(
        {sysId, url},
        this.buildContext({returned: 1}),
      )
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
