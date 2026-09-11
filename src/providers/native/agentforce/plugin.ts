// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Agentforce provider plugin: the one file the registry imports.
 */
import {defineProvider} from '../../../core/provider/plugin.js'
import type {ProviderCommandClass} from '../../../core/provider/plugin.js'
import {createClient} from './client.js'
import {agentforceCredentials} from './credentials.js'
import {classifyAgentforceError} from './errors.js'
import {agentforceMetadata} from './metadata.js'
import AgentforceAgentsList from './commands/agents/list.js'
import AgentforceDiscover from './commands/discover.js'
import AgentforceIntrospect from './commands/introspect.js'
import AgentforceSessionsEnd from './commands/sessions/end.js'
import AgentforceSessionsMessage from './commands/sessions/message.js'
import AgentforceSessionsStart from './commands/sessions/start.js'

export const agentforcePlugin = defineProvider({
  name: 'agentforce',
  displayName: 'Agentforce',
  description: 'Salesforce Agentforce agent sessions',
  metadata: agentforceMetadata,
  credentials: agentforceCredentials,
  createClient,
  classifyError: classifyAgentforceError,
  http: (client) => ({request: (r) => client.rawRequest(r.method, r.path, r.query, r.body)}),
  healthProbe: ['agentforce', 'agents', 'list'],
  commands: {
    'agentforce:agents:list': AgentforceAgentsList,
    'agentforce:discover': AgentforceDiscover,
    'agentforce:introspect': AgentforceIntrospect,
    'agentforce:sessions:end': AgentforceSessionsEnd,
    'agentforce:sessions:message': AgentforceSessionsMessage,
    'agentforce:sessions:start': AgentforceSessionsStart,
  } as Record<string, ProviderCommandClass>,
})
