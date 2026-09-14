# The agent contract

This is the human-readable statement of what an agent can rely on from any CLI built on aclif, whichever provider it talks to. The machine-readable form is the set of JSON Schemas under `schemas/`. Both are versioned together by `CONTRACT_VERSION` (`src/core/contract/version.ts`); every success envelope carries the version in `_context.contract`, and `$BIN version --json` reports it.

Contents: the envelope, errors, exit codes, command metadata, introspection, examples, the audit line, the tenant catalog, manifests, and alias sets. `$BIN` stands for the binary name of the CLI you are using.

## The envelope

Every command writes exactly one JSON document to stdout. Nothing else goes to stdout.

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
    "relatedCommands": ["$BIN salesforce discover --object Account --verbose"]
  }
}
```

| Field | Present | Meaning |
|---|---|---|
| `success` | always | `true` when `result` is meaningful |
| `result` | on success | the command's data; shape is per command and described by `--shape` |
| `_context` | on success | contract version, pagination, rate limit, hints (below) |
| `error` | on failure | an error object (below) |

`_context` always carries:

| Key | Type | Meaning |
|---|---|---|
| `contract` | string | the contract version this envelope conforms to |
| `pagination` | object or null | `returned` (records in this response), `total` (matching records, or null when unknown), `hasMore`, `nextCommand` (a complete command string that fetches the next page, or null) |
| `rateLimit` | object or null | `remaining`, `limit`, `resetsAt` when the API reported them |
| `availableFields` | string[] | field names the caller could request with `--fields` |
| `refinements` | string[] | suggestions for a narrower or better next call |
| `relatedCommands` | string[] | complete command strings worth running next |
| `source` | `"manifest"` | present when the command came from a declarative manifest |
| `canonical` | object | present when `--canonical` resolved the entity: `set`, `entity`, `native`, `instance` |

Command strings in `nextCommand`, `relatedCommands`, `workingExample`, and examples always start with the binary name; they can be run as printed. `schemas/envelope.schema.json` validates every envelope.

Two outputs are not envelopes: the `--dry-run` preview, `{"dryRun": true, "wouldExecute": {...}, "aciMetadata": {...}}`, and the introspection documents below. Both are JSON, both exit 0.

## Errors

```json
{
  "success": false,
  "error": {
    "code": "INVALID_FIELD",
    "message": "No such column 'Cases' on entity 'Case'.",
    "correctedValue": "SELECT AccountId, COUNT(Id) Cases FROM Case GROUP BY AccountId ORDER BY COUNT(Id) DESC",
    "syntaxGuide": "Salesforce SOQL does not allow ORDER BY on aggregate aliases. ...",
    "workingExample": "SELECT AccountId, COUNT(Id) Cases FROM Case GROUP BY AccountId ORDER BY COUNT(Id) DESC LIMIT 10"
  }
}
```

| Field | Meaning |
|---|---|
| `code` | upper-case identifier, stable per provider. `NO_CREDENTIALS`, `INVALID_USAGE`, `CONFIRMATION_REQUIRED`, `COMMAND_ERROR`, `INSUFFICIENT_ACCESS`, `AUTHENTICATION_FAILED`, `RATE_LIMITED`, and `CANONICAL_NOT_FOUND` are shared; providers add their own |
| `message` | what the API or the CLI said |
| `correctedValue` | when the CLI can repair the input, the repaired value, ready to resend |
| `syntaxGuide` | how to fix it, naming the command that helps |
| `workingExample` | a complete command or query that works |

An unknown flag, a missing required flag, or a bad option value produces `INVALID_USAGE` on stdout, never help text. A command run without credentials produces `NO_CREDENTIALS` with every accepted credential path listed in `syntaxGuide`.

## Exit codes

| Code | Meaning | Examples |
|---|---|---|
| 0 | success, or a dry run, or an introspection document | |
| 1 | the API or the command failed | `COMMAND_ERROR`, `RATE_LIMITED`, an unreachable instance |
| 2 | usage | unknown flag, missing input, `CONFIRMATION_REQUIRED`, unknown canonical name, a missing profile |
| 3 | authentication or authorization | `NO_CREDENTIALS`, `AUTHENTICATION_FAILED`, a policy that requires identity |
| 130 | interrupted by SIGINT; a mutation in flight writes a warning line to stderr | |

The error envelope is on stdout in every non-zero case except the configuration errors the hooks raise before a command exists (a missing profile, a denied policy), which print one line to stderr.

## Command metadata

Every command declares `aciMetadata`. It is static, printed by `--schema` and `--discover`, and read by the policy layer and by embedding hosts before the command runs. `schemas/aci-metadata.schema.json` validates it.

| Field | Values | Meaning |
|---|---|---|
| `mutability` | `read`, `create`, `update`, `delete` | what the command does to the target system |
| `idempotent` | boolean | repeating it changes nothing further |
| `reversible` | boolean | the change can be undone through the same API |
| `blastRadius` | `single_record`, `filtered_set`, `all_records` | how much the command can touch |
| `apiCallsConsumed` | integer | calls per invocation, for quota planning |
| `requiresConfirmation` | boolean | `--confirm` is required; always true for deletes, `all_records`, and code execution |
| `prerequisites` | string[] | what must be true first, in words |
| `capabilities` | `code_exec`, `metadata_change`, `bulk` | what the command can do beyond ordinary records |

Governance reads these labels. A command labeled `read` is never asked to confirm; a command labeled `code_exec` always is. Providers are held to the labels by the conformance suite.

## Introspection

Every command answers these flags without executing, without credentials, and without its required flags:

| Flag | Returns |
|---|---|
| `--schema` | flags (type, description, required, default, options, char), args, `aciMetadata`, and `availableEntities` from the tenant catalog when one is cached |
| `--examples` | `aciExamples`: description, a runnable command, and often a `responseShape` |
| `--shape` | `responseShape`: description, fields with types, an example |
| `--changelog` | version history of the command |
| `--discover` | sibling commands with their metadata and child topics; `suggestedStart` |
| `--flags-for <category>` | the command's flags in one category: `filtering`, `output`, `pagination`, `auth`, `bulk` |
| `--estimate` | rough token cost per record, derived from the response structure |

Three commands describe the whole CLI: `discover` (every provider with tier, counts, and credential status), `learn <provider>` (a short briefing: overview, topics, key fields, query syntax, patterns, auth paths, the instance's custom entities when a catalog exists), and `version`. All three are JSON.

The golden test in `test/contract/golden/` freezes the introspection output of every command; a change there is a contract change and is reviewed as one.

## Base flags

| Flag | Meaning |
|---|---|
| `--json` | on by default; the envelope above |
| `--pretty` | indented and colored for a person |
| `--fields a,b` | project each record to these fields |
| `--truncate N` | cap the records returned; the result carries `_truncated: {original, returned}` |
| `--full` | include values the masking rule would replace with `****` (keys that look like password, secret, token, key, authorization, credential) |
| `--dry-run` | print the preview and make no request |
| `--confirm` | acknowledge a command that requires confirmation |
| `--profile`, `--instance` | select credentials from the config file ([CONFIGURATION.md](CONFIGURATION.md)) |
| `--identity-token` | present an identity to the policy layer |
| `--canonical` | treat entity and field names as canonical names and resolve them through the alias sets in use |
| `--bootstrap`, `--refresh`, `--all` | on `introspect`: capture, recapture, or widen the tenant catalog |

Provider credential flags are generated from each provider's credential schema and listed by `--flags-for auth`.

## The audit line

After every command, including failures and usage errors, one line goes to stderr:

```
[AUDIT] {"timestamp":"2026-09-11T01:47:33.628Z","user":null,"command":"salesforce:data:query","exitCode":2,"error":{"code":"INVALID_USAGE","message":"Nonexistent flag: --bogus"}}
```

`user` is the resolved identity's id, or null when anonymous. `error` is present when the command failed.

## Tenant catalog

`$BIN <provider> introspect --bootstrap` captures the instance's custom entities, custom fields on standard entities, enumerations, and relationships into a catalog, cached per provider and instance. `schemas/tenant-catalog.schema.json` defines its structure: `provider`, `capturedAt`, `entities[]` each with `name`, `label`, `custom`, `provenance` (`metadata`, `sample-inference`, or `probe`), and `fields[]` (name, label, type, custom, enum, references). It holds structure only and never holds record values or secrets. `learn` and `--schema` read it.

## Manifests

A declarative manifest turns one HTTP endpoint into a command with the same contract as a static one. `schemas/manifest.schema.json` defines its structure: `id`, `description`, `aciMetadata`, `request` (method, path and query templates, body template, all with `{flag}` placeholders), `flags`, optional `responseShape` and `aciExamples`. A manifest is loaded from the config file per profile, or added by an embedding host; its command answers every introspection flag and its envelope carries `_context.source: "manifest"`.

## Alias sets

An alias set maps canonical entity and field names to each provider and instance's native names. `schemas/alias-set.schema.json` defines its structure: `id`, `entities[]` with `canonical`, `mappings[]` (`provider`, `instance`, `native`), and `fields[]` mapped the same way. `--canonical` resolves through the sets in use; `aliases resolve`, `aliases list`, `aliases validate`, `aliases import`, and `aliases export` manage them. A starter vocabulary ships with the framework.

## What bumps the version

Any change to: the envelope or `_context` keys, the error fields, the exit codes, the `aciMetadata` fields or enums, the introspection documents, the base flags, the audit line, or any schema under `schemas/`. Adding a provider, a command, or a flag to one command does not.
