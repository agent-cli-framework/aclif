# aclif

[![npm](https://img.shields.io/npm/v/@aclif/core)](https://www.npmjs.com/package/@aclif/core) [![ci](https://github.com/agent-cli-framework/aclif/actions/workflows/ci.yml/badge.svg)](https://github.com/agent-cli-framework/aclif/actions/workflows/ci.yml) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Agent CLI Framework.** aclif builds command-line tools for AI agents. One binary covers every provider it is built with. A command's schema, examples, and safety metadata load only when the agent asks, so nothing sits in context by default. Every command returns one JSON envelope with one error vocabulary, declares what it will do before it runs, and runs unchanged spawned by an agent, embedded in a host application, or inside a gateway that holds the credentials. MIT, on npm as `@aclif/core`.

## Why agents need their own CLI

MCP is a protocol between a model and a server. aclif is a tool the agent runs directly.

An MCP server publishes a fixed list of tools, and every tool on the list occupies the agent's context on every turn. The server's author trades coverage for cost when the server is built. Publishing every operation (a typical API has hundreds of definitions) keeps the whole API reachable and consumes tokens for all of it on every turn. Publishing a handful of broad operations keeps the token count small, and any operation the author left off the list is out of the agent's reach. A host can lower the cost with tool filtering or deferred loading, and a server can publish a generic call tool, but each of those is a design-time decision made per server, and it fixes which operations the agent can ever reach. Each server is also its own process to deploy, secure, and keep current, so an agent that spans several platforms needs a server, a login, a grammar, an error format, and a set of names for each.

aclif loads a command's definition only when the agent asks for it, so the whole API of every provider is reachable at no standing cost in context. One grammar, one envelope, and one error vocabulary cover every provider, so the agent's context stays about the same size whether it reaches one platform or five.

An agent that runs a defined workflow can leave the model out of the call altogether. A person or an authoring tool works out the exact command at design time and embeds it in the workflow as a string. At run time the agent executes that string as ordinary code, with no tool definition loaded and no inference. The command is chosen at design time, and the authority to run it, the credential, the acting identity, and the policy, is supplied at run time by whatever runs it. Neither side ever holds both.

The reasoning behind this, with its sources and the measured token and cost figures, is in [docs/MOTIVATION.md](docs/MOTIVATION.md).

## Thirty-second install

The reference CLI is the `aclif` binary in this repository, built with every built-in provider. Nothing here needs credentials:

```bash
npm install -g @aclif/core

aclif discover --json                          # every provider, its commands, whether credentials are configured
aclif learn salesforce --json                  # a briefing: topics, key fields, query syntax, auth paths
aclif salesforce data query --schema           # flags, args, and safety metadata, without executing
aclif salesforce data query --examples         # runnable examples with the responses they produce
aclif salesforce data query --query "SELECT Id, Name FROM Account LIMIT 3" --dry-run
```

The dry run prints what the command would do and its declared safety metadata:

```json
{
  "dryRun": true,
  "wouldExecute": {"query": "SELECT Id, Name FROM Account LIMIT 3"},
  "aciMetadata": {
    "mutability": "read",
    "idempotent": true,
    "reversible": false,
    "blastRadius": "filtered_set",
    "apiCallsConsumed": 1,
    "requiresConfirmation": false,
    "prerequisites": []
  }
}
```

Run the same command without `--dry-run` and, with no credentials configured, the error names every way to supply them, with exit code 3:

```json
{
  "success": false,
  "error": {
    "code": "NO_CREDENTIALS",
    "message": "No Salesforce credentials provided.",
    "syntaxGuide": "Use one of:\n  Session token: --instance-url + --access-token (or SF_INSTANCE_URL, SF_ACCESS_TOKEN)\n  Username + password (+ security token): ...\n  OAuth2 client credentials: --instance-url + --client-id + --client-secret (or SF_INSTANCE_URL, SF_CLIENT_ID, SF_CLIENT_SECRET)"
  }
}
```

To run it for real, point it at an org:

```bash
# Your org's My Domain URL, no trailing slash
export SF_INSTANCE_URL=https://example.my.salesforce.com

# A session token from the Salesforce CLI (sf org login web first if needed)
export SF_ACCESS_TOKEN=$(sf org auth show-access-token -o me@example.com --json | jq -r .result.accessToken)

aclif salesforce data query --query "SELECT Id, Name FROM Account LIMIT 3" --json
```

Without the Salesforce CLI, use an API user. Salesforce emails the security token when the password is set or reset:

```bash
export SF_INSTANCE_URL=https://example.my.salesforce.com SF_USERNAME=me@example.com SF_PASSWORD=... SF_SECURITY_TOKEN=...
aclif salesforce data query --query "SELECT Id, Name FROM Account LIMIT 3" --json
```

Or from a checkout: `npm install && npm run build && node bin/run.js discover --json`. Node 22 or later.

## What every command gives you

- **One grammar.** One command structure, one JSON envelope, and one error vocabulary across every provider. An agent learns the tool once, and a new platform adds commands without adding grammar.
- **Canonical names.** Alias sets map `customer` to `Account` in one Salesforce instance and `core_company` in ServiceNow; `--canonical` resolves them. A tenant catalog, captured from each instance at deploy time, teaches the CLI each instance's custom objects and fields with no change to the provider.
- **Errors an agent can act on.** An agent recovers in one turn. Every error names the failure, the command that fixes it, and, where the provider's classifier has a rewrite rule for the mistake, the corrected input ready to resend. The classifier is plain code with no model behind it. A command validated in a shell at design time returns the same error at run time under any host, because the same command classes run in both.
- **Introspection without execution.** `--schema`, `--examples`, `--shape`, `--changelog`, `--discover`, `--flags-for`, and `--estimate` return before the command runs, need no credentials, and count against no API quota. An agent can discover, learn, introspect, and preview against a rate-limited instance and spend nothing.
- **An embeddable runtime.** The same command classes run in-process inside a host that supplies credentials, identity, and policy per request, keeps connections warm, and caches expensive logins per instance. A gateway built on it works with the enterprise's own identity provider and secrets vault.
- **Declared safety.** Mutability, blast radius, reversibility, idempotency, and whether confirmation is required are declared on every command. A policy gate can refuse it before its code loads. Every mutation accepts `--dry-run`, demands `--confirm` where its metadata says so, and writes an audit line after every run.

Under the same contract: a **tenant catalog** (`introspect --bootstrap`) so `learn` and `--schema` speak the instance's own names, **manifests** that turn one HTTP endpoint into a command from a JSON file, and **sessions** that cache expensive logins per instance, managed with `auth status` and `auth logout`.

## The introspection-first workflow

An agent needs no documentation beyond the binary, and nothing before the last step touches the API:

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

`_context.pagination.nextCommand` is the complete command for the next page. Errors carry a code, a message, a `syntaxGuide` naming the command that fixes the problem, and where possible a `workingExample` and a `correctedValue` ready to resend. Exit codes are 0, 1 (API), 2 (usage), 3 (authentication), so an agent can branch without parsing prose. The full contract, with the JSON Schemas that validate every envelope, is in [docs/CONTRACT.md](docs/CONTRACT.md). The agent-facing skill is [skills/aclif/](skills/aclif/); [docs/USING_WITH_AGENTS.md](docs/USING_WITH_AGENTS.md) says how to install it.

For an agent that executes a defined workflow, do the discovery once. Run `learn`, `--schema`, and `--examples` at design time, embed the exact command string in the workflow, and the agent executes it at run time as ordinary code, with no model in the loop and no inference cost for the call.

## Three ways to run it

A vendor CLI is built for one deployment: installed on a machine, logged in by the person at the keyboard, one process per command, with credentials in its own config file and output meant for a terminal. Behind a gateway that fails. Every call spawns a process and logs in again, the acting user's identity cannot be forwarded, nothing declares what a command will do before it runs, and every tool reports in its own format, so there is nothing uniform to audit.

aclif's command classes run unchanged in three places, and whoever runs them decides who supplies the credentials, who enforces policy, and who keeps the audit trail.

### 1. Run by the agent

The agent process spawns the binary, executes the command, and reads the JSON it returns, the way a coding agent runs `git` or `gh`. Credentials come from flags, environment variables, or a profile in `config.yaml`, in that order; policy comes from the same file; the audit line writes to stderr. The agent learns each command from the binary, because every command returns `--schema`, `--examples`, and `--shape` without credentials and without executing; the workflow and rules it follows are packaged as a skill in [skills/aclif/](skills/aclif/). This is the deployment [docs/USING_WITH_AGENTS.md](docs/USING_WITH_AGENTS.md) describes, and the repository [Dockerfile](Dockerfile) builds a standalone image for it.

Use this when one agent, one operator, and one set of credentials share a trust boundary.

### 2. Run by a host application, the design-time case

An application sits between the model and aclif and holds the credentials. The model calls a tool the application defines, and the application executes the command, in-process through the embedded runtime or by passing a command string to the CLI. In-process, the host imports the package, starts one `Runtime`, and calls `runtime.run({argv, context, credentials, pool, reporter})` from inside its tool handler; no process is spawned, the connection pool stays warm between calls, and the result is the same JSON envelope the binary prints. An authoring tool uses this to let a model discover providers, introspect commands, and validate the exact command it will write into an agent. One tool describing the grammar replaces one tool per operation, and the model loads a command's definition only when it asks for it.

Use this when the model must never hold credentials and tool definitions must stay out of its context.

### 3. Run by a gateway, the runtime case

A deployed agent submits commands, and one long-lived process serves many such agents. The gateway starts one `Runtime` and turns each request into an `Invocation` carrying:

- the command as argv;
- an `ExecutionContext` with a request id, the user's identity and profile, forwarded SSO claims, an abort signal, and free-form audit metadata such as the calling application;
- a `CredentialResolver` the host implements over its secrets store, resolved per request, so credentials never leave the gateway;
- a `capabilityGate` hook that runs on the command's declared metadata before the command class is loaded, so a denied command costs nothing;
- a `rateLimit` hook, a reporter that collects the envelope, and the shared connection pool, which caches clients by provider, instance, identity, and auth type so two instances never share a connection.

The agents on the other side of the socket send a command, an application key, and the acting user's identity token. They hold no provider credentials, cannot reach the provider directly, and cannot widen their own scope, because scope is decided by the gate from metadata on the command. Prompt One's service gateway runs this way, resolving credentials from a vault per request and applying its capability gate on every call; its first version spawned a process per command, and a modest seed job took minutes, most of it process startup and repeated logins. The embedded runtime is what replaced it. Details in [docs/EMBEDDING.md](docs/EMBEDDING.md).

Use this when many agents share providers and one place must hold policy and audit.

| | Run by the agent | Run by a host application | Run by a gateway |
|---|---|---|---|
| Credentials | flags, env, `config.yaml` | host-supplied `CredentialResolver` | vault-backed resolver, per request |
| Policy | `config.yaml` | `capabilityGate` hook | `capabilityGate` hook plus the host's own middleware |
| Identity | `--identity-token` or env | `context.user` on the invocation | `context.user` and `context.sso` from the request |
| Audit | stderr line per run | reporter events | reporter events, recorded by the host |
| Connections | file session cache | runtime pool | runtime pool, keyed per instance and identity |

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

Native providers are maintained by the project and are included in every release, with live smoke tests against real instances. Contributed providers are maintained by the people named in their plugin and are packaged with the release. A third tier, private, is for providers a fork keeps to itself; upstream never touches it. Credentials come from flags, environment variables, or a profile in `config.yaml`, in that order; see [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Writing a provider takes little effort when a coding agent does the work. A provider is a direct translation of the platform's API specification onto the command surface: each operation becomes a command, its parameters become flags, its enumerations become flag options, and its method and path decide the safety metadata. [docs/PROVIDER_AUTHORING.md](docs/PROVIDER_AUTHORING.md) includes a sample generation prompt, [AGENTS.md](AGENTS.md) is the guide written for the coding agent, and the repository ships an `add-provider` skill for Claude Code under [.claude/skills/](.claude/skills/add-provider/SKILL.md) that follows the same steps. The agent generates the provider and runs the conformance suite; you review the result.

## Embedding

A host process imports the package, starts one `Runtime`, and calls `runtime.run({argv, context, credentials, pool, reporter, hooks})` from inside its own tool handler, supplying credentials, identity, and policy per invocation. No process is spawned, the connection pool stays warm between calls, and the result is the same envelope the binary prints. Static, environment, profile, and chained credential resolvers are built in; a host that keeps credentials in a vault implements the one-method `CredentialResolver` interface. The full sample, the `capabilityGate` and `rateLimit` hooks, and the pool and health-monitoring API are in [docs/EMBEDDING.md](docs/EMBEDDING.md).

## Forking

Most teams that want a private provider should build a CLI package (above) and never fork. A team that also changes the framework's core keeps its providers under `src/providers/private/`, a prefix upstream never commits to, so pulling upstream stays conflict-free: [docs/FORKING.md](docs/FORKING.md).

## Development

aclif is built on [oclif](https://oclif.io), the framework under the Salesforce and Heroku CLIs, taken as an ordinary dependency. oclif parses every flag, routes every command, and runs the hook lifecycle; aclif adds the agent contract, the safety metadata, the introspection flags, and the embedded runtime. [docs/MOTIVATION.md](docs/MOTIVATION.md#oclif-the-starting-point-and-its-limit) says where oclif stops and aclif starts.

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

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 Prompt One, Inc. Every shipped source file carries an SPDX identifier; provider directories under `private/` belong to the fork that adds them and may carry their own terms.
