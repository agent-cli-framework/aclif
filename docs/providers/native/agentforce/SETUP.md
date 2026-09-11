# Agentforce setup

The `agentforce` provider drives Salesforce agents through the Agent API (`api.salesforce.com/einstein/ai-agent/v1`) and lists them through the org's Data API. It authenticates with the OAuth 2.0 client credentials flow of an **External Client App** (ECA) minted against the org's My Domain token endpoint. It is a separate provider from `salesforce` on purpose: different credential type, different rate limits, different rotation. `$BIN` stands for your CLI's binary name.

## Credential path

| Field | Flag and variable | What it is |
|---|---|---|
| My Domain URL | `--my-domain-url`, `AGENTFORCE_MY_DOMAIN_URL` | `https://<org>.my.salesforce.com`, no trailing slash |
| Client id | `--client-id`, `AGENTFORCE_CLIENT_ID` | the ECA consumer key |
| Client secret | `--client-secret`, `AGENTFORCE_CLIENT_SECRET` | the ECA consumer secret |
| Default agent id | `--agent-id`, `AGENTFORCE_AGENT_ID` | optional; the 18-character id `sessions start` uses when none is given |

## Step 1: an org with Agentforce

Any Developer Edition org works once Einstein is on (Setup, Einstein Setup, Turn on Einstein). The Agentforce Developer Edition signup ships sample agents and topics and is faster to exercise. Capture the My Domain URL from Setup, Company Settings, My Domain.

## Step 2: an agent the API can drive

Not every agent type is reachable through the Agent API. The preloaded "Agentforce (Default)" employee agent is of type `InternalCopilot`, which is UI-only; a session request against it returns an empty 404. Create an agent in Agentforce Studio of type **Agentforce Service Agent** (or any custom non-`InternalCopilot` type), then:

1. **Activate** it; new agents start as drafts and are invisible to the API until activated. Allow about thirty seconds.
2. Give it at least one **topic** with actions.
3. Confirm the ECA from step 3 appears under the agent's Connections, Messaging, External Apps. A correctly configured ECA appears there on its own; the "Add external app" dialog lists classic connected apps only and will never show an ECA. If the ECA is missing from that list, one of its settings is wrong; the list shows every app in the org that qualifies for the Agent API.

`$BIN agentforce agents list --json` reports `supportedByAgentApi` per agent, which rules out the `InternalCopilot` type but not the activation and topic conditions.

## Step 3: the External Client App

Setup, External Client App Manager, New External Client App. Two groups of settings matter; both are required end to end.

Visibility (the ECA shows up in the agent's External Apps list):

- Enable OAuth. Callback URL: `https://login.salesforce.com/services/oauth2/success` (unused by client credentials, required by the form).
- All four scopes: `api`, `refresh_token, offline_access`, `chatbot_api`, `sfap_api`.
- Policies, OAuth Policies: **Issue JSON Web Token (JWT)-based access tokens** on.

Function (token minting and sessions work):

- **Enable Client Credentials Flow**.
- Policies, OAuth Policies, **Run As**: an active user. That user runs every session by default (`sessions start` sends `bypassUser: false`); in a dev org, a System Administrator avoids permission set license traps. `sessions start --bypass-user` runs the session as the agent's own user instead.

Save, then wait about ten minutes: Salesforce propagates OAuth changes slowly, and a fresh consumer key answers `invalid_client_id` until then. The consumer key and secret are under Settings, OAuth Settings, Manage Consumer Details.

## Verify

```bash
export AGENTFORCE_MY_DOMAIN_URL=https://example.my.salesforce.com AGENTFORCE_CLIENT_ID=... AGENTFORCE_CLIENT_SECRET=...
$BIN agentforce discover --json                                   # token exchange and hosts
$BIN agentforce agents list --json                                # find an agent with supportedByAgentApi: true
$BIN agentforce sessions start --agent-id 0Xx... --confirm --json
$BIN agentforce sessions message --session-id <id> --message "Hello" --confirm --json
$BIN agentforce sessions end --session-id <id> --confirm --json
```

## Rotation

Access tokens expire on the org's session timeout policy; the client re-mints them transparently. The consumer secret rotates only when you rotate it (Manage Consumer Details, Rotate Secret), when the Run As user is deactivated, or when you move from sandbox to production (a different ECA and My Domain URL). Update the two values and, if a session cache exists on the host, clear it.

## Errors you will meet

| Code | Cause | Fix |
|---|---|---|
| `INVALID_CLIENT` | the ECA is younger than ten minutes, or the key is wrong | wait, then retry |
| `CLIENT_CREDENTIALS_DISABLED` | Client Credentials Flow is off | enable it on the ECA |
| `INVALID_GRANT` | the Run As user is inactive or lacks scopes | fix the OAuth policy |
| `INSUFFICIENT_SCOPE` | 403 from the Agent API | add `chatbot_api` and `sfap_api`, wait ten minutes |
| `AGENT_NOT_FOUND` | wrong id (sandbox id, or 15 characters) | use the 18-character id from Setup |
| `AGENT_TYPE_UNSUPPORTED` | empty 404 on session start | the agent is `InternalCopilot`, a draft, has no topic, or the ECA is missing a visibility setting |
