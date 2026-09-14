# aclif reference

Supporting detail for [SKILL.md](SKILL.md). The command topology below is a snapshot; `aclif discover --json` and `--discover` on any command return the current one.

## Introspection flags

These flags return before the command executes and need no credentials. They skip required-flag validation.

| Flag | Returns |
|---|---|
| `--schema` | flag and argument definitions plus the safety metadata |
| `--examples` | usage examples with the responses they produce |
| `--shape` | the structure of a successful result: fields, types, examples |
| `--discover` | sibling commands and child topics at this point in the hierarchy |
| `--changelog` | version history for this command |
| `--flags-for <category>` | flags for one use: `filtering`, `output`, `pagination`, `auth`, `bulk` |
| `--estimate` | token cost estimate without executing |

## Base flags on every command

| Flag | Type | Default | Description |
|---|---|---|---|
| `--json` | boolean | `true` | output JSON |
| `--fields` | string | none | comma-separated fields to return |
| `--dry-run` | boolean | `false` | preview a mutation without executing it |
| `--estimate` | boolean | `false` | estimate response size |
| `--diff` | boolean | `false` | show only changed fields on a mutation |
| `--truncate` | integer | none | maximum records to return |
| `--full` | boolean | `false` | include sensitive values in output; never use it |
| `--pretty` | boolean | `false` | colored output for a person |
| `--profile` | string | none | named profile from the config file, or `ACLIF_PROFILE` |
| `--instance` | string | none | named instance within the profile, for providers with more than one |
| `--confirm` | boolean | `false` | confirm a command that requires explicit confirmation |
| `--identity-token` | string | none | identity token verified by the configured identity provider, or `ACLIF_IDENTITY_TOKEN` |

## Safety metadata

Every command declares fixed metadata, returned by `--schema`:

```json
{
  "mutability": "read | create | update | delete",
  "idempotent": true,
  "reversible": false,
  "blastRadius": "single_record | filtered_set | all_records",
  "apiCallsConsumed": 1,
  "requiresConfirmation": false,
  "prerequisites": []
}
```

- `mutability`: what the command does to the target system.
- `blastRadius`: how many records could be affected.
- `requiresConfirmation`: when `true`, `--confirm` is mandatory.
- `idempotent`: whether running it twice produces the same result.
- `reversible`: whether the effect can be undone.

## Credential resolution

First match wins:

1. Command flags such as `--instance-url` and `--access-token`.
2. Environment variables such as `SF_INSTANCE_URL` and `SF_ACCESS_TOKEN`.
3. A profile in the config file, selected with `--profile <name>` or `ACLIF_PROFILE`.

`aclif auth status --json` reports which profile and credentials are in effect without revealing a secret.

## Envelope

Success:

```json
{
  "success": true,
  "result": { },
  "_context": {
    "pagination": {
      "returned": 10,
      "total": 100,
      "hasMore": true,
      "nextCommand": "aclif salesforce data query --query \"...\" --offset 10"
    },
    "rateLimit": null,
    "availableFields": [],
    "refinements": ["Add --where to filter results"],
    "relatedCommands": ["aclif salesforce data describe Account"]
  }
}
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_FIELD",
    "message": "Field 'Foo__c' does not exist on Account",
    "syntaxGuide": "Use --schema to see available fields",
    "workingExample": "aclif salesforce data query --query \"SELECT Id, Name FROM Account LIMIT 5\""
  }
}
```

A command run without credentials returns `NO_CREDENTIALS` with every accepted credential path listed in `syntaxGuide`. Command strings in `nextCommand`, `relatedCommands`, and `workingExample` start with the binary name and can be run as given.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | API or runtime error; `error.code` says which |
| 2 | invalid usage: unknown flag, missing required flag, or bad value |
| 3 | credentials missing or rejected |
| 130 | interrupted; the operation may have partly completed |

## Command topology

```
aclif discover                          # list all providers
aclif learn <provider>                  # provider briefing (~500 tokens)

salesforce
├── discover                            # list Salesforce objects and topics
├── introspect                          # deep org schema discovery
├── data
│   ├── query    -q                     # SOQL queries
│   ├── aggregate                       # SOQL aggregate queries
│   ├── describe                        # object metadata
│   ├── dml      <operation> <object>   # insert/update/delete/upsert
│   ├── search   -q                     # SOSL full-text search
│   └── search-objects                  # find objects by name
├── metadata
│   ├── object                          # create/describe custom objects
│   ├── field                           # create/describe custom fields
│   └── permissions                     # view field-level security
├── apex
│   ├── run                             # execute anonymous Apex
│   ├── get-class                       # retrieve Apex class source
│   ├── deploy-class                    # deploy Apex class
│   ├── get-trigger                     # retrieve trigger source
│   └── deploy-trigger                  # deploy trigger
└── debug-log
    └── manage                          # enable/disable debug logging

servicenow
├── discover                            # list ServiceNow tables
├── introspect                          # deep table schema discovery
├── data
│   ├── query    -t -q                  # table queries (encoded query syntax)
│   ├── aggregate -t -q                 # aggregate queries
│   ├── describe                        # table/field metadata
│   ├── dml      <operation> -t         # insert/update/delete
│   └── search   -t                     # full-text search
└── script
    └── run      -c                     # execute server-side scripts
```

DocuSign, Agentforce, and Google Workspace follow the same grammar. `aclif learn <provider> --json` returns each one's topics.
