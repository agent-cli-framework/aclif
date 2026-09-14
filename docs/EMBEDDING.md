# Embedding the runtime

A host process (an HTTP gateway, a job runner, a test harness) can run commands in-process instead of spawning the binary. The host gets the same commands, the same envelope, and the same metadata, and supplies credentials, identity, and policy itself. The standalone binary's hooks, config file, session cache, and audit line are not involved; the host owns those concerns.

Everything below is exported from the package root (`import {...} from 'aclif'`).

## Start

```ts
import {Runtime} from 'aclif'

const runtime = await Runtime.start({
  cliRoot: '/path/to/the/cli/package',        // the CLI package built with defineCli(); defaults to the framework's own root
  pool: {max: 100, ttl: 30 * 60 * 1000},      // connection pool size and TTL
  health: {degradedThreshold: 3, unhealthyThreshold: 5},
})
console.log(runtime.config.commands.length)   // the full command catalog
```

`Runtime.start` loads the CLI package's oclif `Config`, which imports the command target where `defineCli()` ran, so the registry the runtime uses is the one that CLI declared. Start it once and share it; commands run concurrently on one runtime because every invocation carries its own state. `runtime.stop()` clears the probe timer.

## Run a command

```ts
import {EventReporter, StaticCredentialResolver, type Invocation} from 'aclif'

const reporter = new EventReporter()
const invocation: Invocation = {
  argv: ['salesforce', 'data', 'query', '--query', 'SELECT Id, Name FROM Account LIMIT 5'],
  context: {requestId: 'req-42', user: {id: 'u1', username: 'alice'}},
  credentials: new StaticCredentialResolver(new Map([
    ['salesforce', {instanceUrl: 'https://example.my.salesforce.com', accessToken: '...', authType: 'session'}],
  ])),
  pool: runtime.pool,
  reporter,
}
const result = await runtime.run(invocation)
// result.exitCode, result.success, result.errorCategory ('invalid_usage' | 'auth_failure' | 'api_error'), result.envelope
```

`argv` is the command line without the binary name (a leading token equal to the CLI's bin is stripped); `--json` is appended if absent. The runtime resolves the longest matching command id, loads the class, and runs `init()` and `run()` with the invocation attached. Introspection flags work the same as on the command line.

### What the runtime replaces

| Standalone behavior | Embedded behavior |
|---|---|
| `this.log()` writes stdout | the envelope goes to `reporter.result` or `reporter.error`; other JSON to `reporter.result`; plain text to `reporter.log('info', ...)` |
| `this.exit(code)` and `this.error()` end the process | they become `AciRuntimeError`s that `run()` turns into `exitCode` and an error envelope |
| credentials from flags, env, profile | `invocation.credentials.get(provider)` |
| the process-wide connection pool | `invocation.pool` (normally `runtime.pool`) |
| the file session cache | not used; the pool holds live clients |
| the file tenant cache and alias files | `invocation.tenantCache` and `invocation.aliasStore` when the host provides them |
| policy from `config.yaml` | `invocation.hooks.capabilityGate` |
| the audit line | `reporter.audit(...)` events, or whatever the host records from `RunResult` |

`$BIN` in every command string renders as the CLI's bin name, as it does standalone.

## Reporters

`EventReporter` collects events and produces the envelope: `reporter.envelope()` returns `{success, result, _context}` or `{success: false, error}` plus `_events` (every result, error, log, audit, and progress event in order). `StdoutReporter` writes as the binary would. Implement `Reporter` for anything else.

## Credentials

A `CredentialResolver` answers `get(provider)` with `ServiceAccountCredentials` or undefined. Built in:

| Resolver | Source |
|---|---|
| `StaticCredentialResolver(map)` | a map of provider to credentials |
| `EnvCredentialResolver(registry, env)` | the provider's environment variables, through its credential schema |
| `ProfileCredentialResolver(registry, profile)` | one profile section from a config file |
| `ChainCredentialResolver([...])` | first resolver that answers |

A host that keeps credentials in a vault implements the interface and resolves per request; the pool caches the client by provider, instance URL, identity, and auth type, so two instances never share a connection.

## Hooks

```ts
hooks: {
  capabilityGate: async ({commandId, aciMetadata, argv}, ctx) => {
    if (aciMetadata.mutability === 'delete' && !ctx.user) return {allowed: false, error: {code: 'DENIED', message: 'Deletes need a user'}}
    return {allowed: true}
  },
  rateLimit: async (provider) => { /* throw to refuse */ },
}
```

The gate runs before the command class is loaded, on the metadata from the catalog, so a denied command costs nothing. A denial returns exit 3 with the gate's error; a gate that throws returns `CAPABILITY_GATE_ERROR` (or the thrown `AciRuntimeError` as is).

## Manifests, tenant catalogs, aliases

- `runtime.addManifestCommands(provider, manifests)` adds declarative commands to the catalog for the runtime's lifetime; ids must not collide with existing commands.
- `invocation.tenantCache` implements `TenantCache` (`load`, `save` by provider and instance key). With it, `introspect --bootstrap` persists through the host, and `learn` and `--schema` read the host's catalog. `instanceKey(provider, creds)` from the package computes the key.
- `invocation.aliasStore` implements `AliasStore`; `--canonical` resolves through it. `AliasResolver` is the reference implementation over a list of `AliasSet`s.

## Health

`runtime.healthMonitor` records every provider command's outcome (an envelope with `success: false` counts as a failure, whatever the exit code) and classifies failures from the error code and message: `hibernating`, `auth_failed`, `rate_limited`, `service_error`, `network_error`, `parse_error`. `getHealth(provider)` returns status, counts, p50 and p99 latency, and the error rate over the last minute. `runtime.probeTimer.register({provider, argv, credentials, intervalMs})` runs a read probe when a provider has been idle; `runtime.probeDefaults()` gives each plugin's declared probe.

## Exit codes and errors

`RunResult.exitCode` follows the contract (0, 1, 2, 3) and `errorCategory` is the coarse mapping. An `AciRuntimeError` thrown anywhere in a command passes through with its code; an oclif parse failure becomes `COMMAND_INVOCATION_ERROR` with exit 2; anything else becomes `COMMAND_ERROR` with exit 1. Detection is structural (`isAciRuntimeError`), so a host that ends up with two copies of the package still gets the right codes.

## A minimal Express handler

```ts
app.post('/execute', async (req, res) => {
  const reporter = new EventReporter()
  const result = await runtime.run({
    argv: req.body.argv,
    context: {requestId: req.id, user: req.user},
    credentials: vaultResolver.for(req.instance),
    pool: runtime.pool,
    reporter,
    hooks: {capabilityGate: gateFor(req.app)},
  })
  res.status(result.exitCode === 0 ? 200 : result.exitCode === 3 ? 403 : 400).json(result.envelope)
})
```
