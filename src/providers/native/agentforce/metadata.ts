// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {ProviderMetadata} from '../../../core/contract/aci.js'

export const agentforceMetadata: ProviderMetadata = {
  name: 'agentforce',
  description: 'Salesforce Agentforce — chat with autonomous AI agents via the Agent API',
  overview:
    'Salesforce Agentforce agents are session-oriented: start a session against a specific agent, exchange Text messages, then end the session. Agents organize their capabilities into Topics (what the agent will discuss) and Actions (flows / Apex / prompt templates the agent can invoke). Use this provider to delegate complex CRM workflows — multi-object queries, opportunity scoring, approval flows — that would be impractical to express as raw SOQL via the `salesforce` provider.',
  querySyntax:
    'Free-form natural language. Each `sessions message` call accepts a single Text utterance and returns a structured envelope with reply text plus any action results the agent emitted.',
  providerSpecificFlags: [
    '--my-domain-url — Salesforce my.salesforce.com domain URL (e.g., https://acme.my.salesforce.com)',
    '--client-id — External Client App consumer key (OAuth client_id)',
    '--client-secret — External Client App consumer secret',
    '--agent-id — Default agent ID to start sessions against (15- or 18-char Salesforce ID, e.g., 0XxAB000000...)',
  ],
  topics: {
    sessions: {
      description: 'Start, message, and end conversation sessions with an Agentforce agent',
      commands: ['start', 'message', 'end'],
      keyFields: ['sessionId', 'agentId', 'messages'],
      commonPatterns: [
        'Start a session: $BIN agentforce sessions start --json',
        'Start against a specific agent: $BIN agentforce sessions start --agent-id 0XxAB000000XXXXAB1 --json',
        'Send a message: $BIN agentforce sessions message --session-id <sid> --message "Summarize Acme Corp\'s open opportunities" --json',
        'End the session: $BIN agentforce sessions end --session-id <sid> --json',
      ],
    },
    agents: {
      description: 'Inspect agents configured in the connected Salesforce org',
      commands: ['list'],
      keyFields: ['id', 'name', 'topics'],
      commonPatterns: [
        'List agents the configured ECA can see: $BIN agentforce agents list --json',
      ],
    },
  },
}
