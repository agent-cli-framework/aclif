# aclif

**Agent CLI Framework.** [oclif](https://oclif.io) is the framework behind the Salesforce, Shopify, Adobe, and Twilio CLIs. It solved the hard parts of building a command-line tool for people: parsing flags, routing commands, generating help, loading plugins, etc. aclif takes this foundation and builds on it to address the unique requirements of agent access to external services. Agents need their own cli for serval reasons. MCP protocol servers add an abstraction layer between an agent and an API which loses fidelity and increases token and context costs.  And workflow agents, because of their pre-defined execution paths, do not (and should not) select their own [tools](docs/MOTIVATION.md). In addition, a unified CLI, enabled by aclif, avoids the operational problems with cli sprawl. 

An agent that works across several SaaS platforms needs a different tool for each one, each with its own command grammar, login, error format, and names for the same things. Every one of those differences takes up context on every call. The agent also needs to know what a command will do before it runs it, needs results and errors it can act on without parsing chat response prose, and should never hold live credentials while it reads untrusted content. When many agents run through one gateway, the tool also has to stay fast and keep an audit record of who did what.

aclif provides one grammar, one response format, and one error format across every provider, so an agent learns the tool once. Every command describes its own flags and examples on request, declares whether it reads, writes, or deletes, and can be refused by policy before it runs. Canonical names let an agent ask for customers and let the CLI map that to each platform's own field names. The same commands run from a shell or inside a gateway that holds the credentials, pools connections, and records every call.

## Deployment flexibility

A vendor CLI is built for one deployment: installed on a machine, logged in by the person at the keyboard, run as a process per command, with credentials in its own config file and output meant for a terminal. Giving an agent access to three platforms, for example, requires three binaries to install and patch, three login flows, three credential stores, and three output formats to parse. Running them behind a server or security gateway, where every call is checked and recorded, is impractical for several reasons.

- Every call spawns a process, logs in again, and needs its credentials written where that process can read them.
- Each CLI acts as whoever logged it in, so the acting user's identity cannot be forwarded.
- Nothing declares what a command will do before it runs, so policy has nothing to check.
- Every tool reports in its own format, so there is nothing uniform to audit.

aclif is one package whose command classes run unchanged in three deployments, and the host decides what changes between them: who supplies the credentials, who enforces policy, and who keeps the audit trail.

### 1. In the agent's own environment

The binary sits on the agent's PATH and the agent shells out to it, the way a coding agent runs `git` or `gh`. Credentials come from flags, environment variables, or a profile in `config.yaml`, in that order; policy comes from the same file; the audit line lands on stderr. The agent needs no documentation beyond the binary, because every command answers `--schema`, `--examples`, and `--shape` without credentials and without executing. This is the deployment [docs/USING_WITH_AGENTS.md](docs/USING_WITH_AGENTS.md) is written for, and the repository [Dockerfile](Dockerfile) builds a standalone image for it.

Use this when one agent, one operator, and one set of credentials live in the same trust boundary.

### 2. As a tool call

A host binds commands as functions the model can call. There are two forms.

In-process: the host imports the package, starts one `Runtime`, and calls `runtime.run({argv, context, credentials, pool, reporter})` from inside its tool handler. No process is spawned, the connection pool stays warm between calls, and the result is the same JSON envelope the binary prints. See [Embedding](#embedding) below.

Through an agent application: the model is given a single tool whose arguments are a command string, its flags, and a tenant instance. The model composes the command exactly as it would on a shell, using `--schema` and `--examples` first, and the application forwards it. This is how Prompt One's AppMaker agents work: their `gateway_execute(command, instance, flags)` tool carries a command such as `salesforce data query` and its flags, and the agent process holds no SaaS credentials at all, only a key identifying the application and the active user's identity.

Use this when tool definitions must stay out of the model's context. One tool describing the grammar replaces one tool per operation, and the model loads a command's definition only when it asks for it.

### 3. As a gateway serving a collection of agents

A long-lived process starts one `Runtime` and listens for commands from many agents at once. Each request becomes an `Invocation` carrying:

- the command as argv;
- an `ExecutionContext` with a request id, the user's identity and profile, forwarded SSO claims, an abort signal, and free-form audit metadata such as the calling application;
- a `CredentialResolver` the host implements over its secrets store, resolved per request, so credentials never leave the gateway;
- a `capabilityGate` hook that runs on the command's declared metadata before the command class is loaded, so a denied command costs nothing;
- a `rateLimit` hook, a reporter that collects the envelope, and the shared connection pool, which caches clients by provider, instance, identity, and auth type so two tenants never share a connection.

The agents on the other side of the socket send a command, an application key, and a user id. They hold no provider credentials, cannot reach the provider directly, and cannot widen their own scope, because scope is decided by the gate from metadata on the command. Prompt One's service gateway runs this way: an Express server calls `Runtime.start` once, builds an invocation per HTTP request, resolves credentials from a vault by application mode (shared org-level service account or the individual user's own entry), and applies its capability gate on every call. The first version of that gateway spawned a process per command, and a modest seed job took minutes, most of it process startup and repeated logins; the embedded runtime is what replaced it. Details in [docs/EMBEDDING.md](docs/EMBEDDING.md).

Use this when many agents share providers, credentials must stay external to every agent, and one place must hold the policy and the audit trail.

| | Binary on PATH | Tool call, in-process | Gateway |
|---|---|---|---|
| Credentials | flags, env, `config.yaml` | host-supplied `CredentialResolver` | vault-backed resolver, per request |
| Policy | `config.yaml` | `capabilityGate` hook | `capabilityGate` hook plus the host's own middleware |
| Identity | `--identity-token` or env | `context.user` | `context.user` and `context.sso` from the request |
| Audit | stderr line per run | reporter events | reporter events, recorded by the host |
| Connections | file session cache | runtime pool | runtime pool, keyed per tenant and identity |

## The introspection-first workflow

An agent needs no documentation beyond the binary:

```bash
aclif discover --json                                   # every provider, its tier, whether credentials are configured
aclif learn salesforce --json                           # a briefing: topics, key fields, query syntax, auth paths
aclif salesforce data query --schema                    # flags, args, safety metadata, no execution
aclif salesforce data query --examples                  # runnable examples with the responses they produce
aclif salesforce data query --query "SELECT Id, Name FROM Account LIMIT 5" --dry-run
aclif salesforce data query --query "SELECT Id, Name FROM Account LIMIT 5" --json
```

Every result is one JSON envelope:

```json
{
  "success": true,
  "result": {"records": [{"Id": "001xx", "Name": "Acme"}], "totalSize": 1, "done": true},
  "_context": {
    "contract": "1.0.0",
    "pagination": {"returned": 1, "total": 1, "hasMore": false, "nextCommand": null},
    "rateLimit": null,
    "availableFields": [],
    "refinements": [],
    "relatedCommands": ["aclif salesforce discover --object Account --verbose"]
  }
}
```

Errors carry a code, a message, a hint that names the command that fixes the problem, and where possible a corrected value ready to resend. Exit codes are 0, 1 (API), 2 (usage), 3 (authentication). The full contract, with the JSON Schemas that back it, is in [docs/CONTRACT.md](docs/CONTRACT.md). The agent-facing quick start is [docs/USING_WITH_AGENTS.md](docs/USING_WITH_AGENTS.md).

## Thirty-second install

The reference CLI is the `aclif` binary in this repository, built with every built-in provider:

```bash
npm install -g @aclif/core
export SF_INSTANCE_URL=https://example.my.salesforce.com SF_ACCESS_TOKEN=...
aclif salesforce data query --query "SELECT Id, Name FROM Account LIMIT 3" --json
```

Or from a checkout: `npm install && npm run build && node bin/run.js discover --json`. Node 22 or later.

## Build your own CLI

aclif is a framework; the binary you ship is yours. It names itself, picks its providers, and gets everything else from the framework:

```bash
npx --package @aclif/core aclif-scaffold-cli --name mycli --dir ../mycli --providers salesforce,servicenow
cd ../mycli && npm install && npm run build && ./bin/run.js discover --json
```

Here `mycli` stands for whatever you name yours. The result is a CLI called `mycli`: its own name in every example and hint, its own config directory, its own scoped environment variables (`MYCLI_PROFILE`), and only the providers it chose, plus any it declares itself. Details in [docs/BUILDING_A_CLI.md](docs/BUILDING_A_CLI.md).

## Providers

| Provider | Tier | Authentication | Setup |
|---|---|---|---|
| Salesforce | native | session token; username and password with security token; OAuth client credentials | [SETUP](docs/providers/native/salesforce/SETUP.md) |
| ServiceNow | native | OAuth bearer token; HTTP Basic | [SETUP](docs/providers/native/servicenow/SETUP.md) |
| DocuSign | native | JWT Grant with an RSA key | [SETUP](docs/providers/native/docusign/SETUP.md) |
| Agentforce | native | External Client App client credentials | [SETUP](docs/providers/native/agentforce/SETUP.md) |
| Google Workspace (Gmail, Calendar) | contributed | OAuth refresh token; service account with domain-wide delegation; access token | [SETUP](docs/providers/contributed/google/SETUP.md) |

Native providers are maintained by the project and gate every release. Contributed providers are maintained by the people named in their plugin. A third tier, private, is for providers a fork keeps to itself; upstream never touches it. Credentials come from flags, environment variables, or a profile in `config.yaml`, in that order; see [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Adding a provider is a mechanical projection of the platform's API specification onto the command surface, which a coding agent does well and the conformance suite checks: [docs/PROVIDER_AUTHORING.md](docs/PROVIDER_AUTHORING.md).

## What every command gives you

- **Introspection without execution**: `--schema`, `--examples`, `--shape`, `--changelog`, `--discover`, `--flags-for`, `--estimate`. No credentials needed.
- **Safety metadata**: mutability, blast radius, reversibility, idempotency, capabilities, and whether confirmation is required, declared on every command and enforced by the policy layer.
- **Dry run** on every mutation, `--confirm` where the metadata demands it, and an audit line on stderr after every run.
- **Tenant catalogue**: `introspect --bootstrap` captures an instance's custom objects, fields, and enumerations so `learn` and `--schema` speak the customer's names.
- **Canonical names**: alias sets map `customer` to `Account` in one org, `core_company` in another; `--canonical` resolves them.
- **Manifests**: a declarative JSON file turns one HTTP endpoint into a command with the same contract as a static one.
- **Sessions**: expensive logins are cached per instance with `auth status` and `auth logout` to manage them.

## Embedding

A host process runs commands in-process instead of spawning the binary, supplying credentials, identity, and policy per invocation:

```ts
import {Runtime, EventReporter, StaticCredentialResolver} from 'aclif'

const runtime = await Runtime.start({cliRoot: '/path/to/your/cli'})
const reporter = new EventReporter()
const result = await runtime.run({
  argv: ['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account LIMIT 1'],
  context: {requestId: 'req-1', user: {id: 'u1', username: 'alice'}},
  credentials: new StaticCredentialResolver(new Map([['salesforce', {instanceUrl, accessToken, authType: 'session'}]])),
  pool: runtime.pool,
  reporter,
  hooks: {
    capabilityGate: async ({aciMetadata}, ctx) =>
      aciMetadata.mutability === 'delete' && !ctx.user
        ? {allowed: false, error: {code: 'DENIED', message: 'Deletes need a user'}}
        : {allowed: true},
  },
})
console.log(result.exitCode, reporter.envelope())
```

`StaticCredentialResolver`, `EnvCredentialResolver`, `ProfileCredentialResolver`, and `ChainCredentialResolver` are built in; a host that keeps credentials in a vault implements the one-method `CredentialResolver` interface and resolves per request. Connection pooling, health monitoring, probe timers, and rate-limit hooks are part of the runtime: [docs/EMBEDDING.md](docs/EMBEDDING.md).

## Forking

Most teams that want a private provider should build a CLI package (above) and never fork. A team that also changes the framework's core forks it and keeps its providers under `src/providers/private/`, a prefix upstream never commits to and upstream CI refuses to accept, so pulling upstream stays conflict-free and core fixes go back upstream from a clean branch. [docs/FORKING.md](docs/FORKING.md).

## Development

```bash
npm install            # generates the provider index
npm run build          # tsc, data files, topic table
npm test               # vitest, then lint and the circular-dependency check
npm run test:coverage  # the same with coverage thresholds
npm run golden:capture # refresh the introspection goldens after a contract change
```

The test suite has six layers: unit, conformance, provider fixture, end-to-end binary, contract goldens, and an opt-in live smoke (`ACI_LIVE_TESTS=1`). CI runs on Linux and Windows, Node 22 and 24, and simulates a fork adding a private provider on every push.

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 Prompt One, Inc. Every source file carries an SPDX identifier; provider directories under `private/` belong to the fork that adds them and may carry their own terms.
