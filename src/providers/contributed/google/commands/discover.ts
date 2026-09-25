// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {GoogleBaseCommand} from '../base.js'
import type {AciMetadata, ResponseShape} from '../../../../core/contract/aci.js'

/**
 * Discover available Google Workspace services and their capabilities.
 *
 * Unlike Salesforce discover (which inspects custom objects in a live org),
 * Google Workspace discover reports the statically-known services and their
 * command sets. Live service probing is handled by the introspect command.
 *
 * Examples:
 *   aclif google discover --json
 */
export default class GoogleDiscover extends GoogleBaseCommand {
  static override description = 'List available Google Workspace services and their commands'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 0,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: "Google Workspace services, commands, scopes, and authentication methods",
    fields: {
      provider: {type: "string", description: "always \"google\""},
      services: {type: "array", description: "array of {name, description, commands, scopes, querySyntax}"},
      totalCommands: {type: "number", description: "commands across services"},
      authentication: {type: "object", description: "{methods: [{name, flags, envVars, setupGuide}]}"},
    },
    example: {"provider": "google", "services": [{"name": "gmail", "description": "Gmail", "commands": ["query", "get"], "scopes": ["https://www.googleapis.com/auth/gmail.readonly"], "querySyntax": "from:, to:, subject:"}], "totalCommands": 2, "authentication": {"methods": [{"name": "OAuth2 refresh token", "flags": "--gw-client-id + --gw-client-secret + --refresh-token", "envVars": "GW_CLIENT_ID, GW_CLIENT_SECRET, GW_REFRESH_TOKEN", "setupGuide": "..."}]}},
  }

  static override flags = {
    ...GoogleBaseCommand.baseFlags,
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return

    const services = [
      {
        name: 'gmail',
        description: 'Gmail email operations',
        commands: ['query', 'get', 'send', 'reply', 'draft'],
        scopes: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.modify',
        ],
        querySyntax: 'Gmail search operators: from:, to:, subject:, is:unread, has:attachment, after:YYYY/MM/DD, before:YYYY/MM/DD, in:anywhere',
      },
      {
        name: 'calendar',
        description: 'Google Calendar event operations',
        commands: ['query', 'get', 'create', 'update', 'delete'],
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
        ],
        querySyntax: 'Structured flags: --time-min, --time-max (RFC3339), --query (free text search)',
      },
      {
        name: 'drive',
        description: 'Google Drive folder listing and file metadata',
        commands: ['list', 'get', 'view-url'],
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
        ],
        querySyntax: 'Structured flags: --folder-id, --recursive',
      },
    ]

    const totalCommands = services.reduce((sum, s) => sum + s.commands.length, 0)

    await this.outputResult({
      provider: 'google',
      services,
      totalCommands,
      authentication: {
        methods: [
          {
            name: 'OAuth2 refresh token (personal Gmail)',
            flags: '--gw-client-id + --gw-client-secret + --refresh-token',
            envVars: 'GW_CLIENT_ID, GW_CLIENT_SECRET, GW_REFRESH_TOKEN',
            setupGuide: '1) Create an OAuth2 client in Google Cloud Console (Desktop or Web app type). 2) Run the consent flow to get a refresh token. 3) Store the client ID, client secret, and refresh token.',
          },
          {
            name: 'Service Account + Domain-Wide Delegation (Workspace)',
            flags: '--service-account-key + --delegated-user',
            envVars: 'GW_SERVICE_ACCOUNT_KEY, GW_DELEGATED_USER',
            setupGuide: '1) Create a service account in Google Cloud Console. 2) Enable the relevant APIs. 3) Configure Domain-Wide Delegation in Google Admin Console with the required scopes.',
          },
          {
            name: 'Pre-obtained access token (short-lived)',
            flags: '--access-token',
            envVars: 'GW_ACCESS_TOKEN',
            setupGuide: 'Obtain a token via OAuth2 playground or CLI. Expires in ~1 hour.',
          },
        ],
      },
    }, this.buildContext({
      returned: services.length,
      refinements: [
        'Use "$BIN learn google" for a compact agent briefing',
        'Use "$BIN google introspect" to validate service account permissions',
      ],
      relatedCommands: [
        '$BIN learn google --json',
        '$BIN google introspect --json',
      ],
    }))
  }
}
