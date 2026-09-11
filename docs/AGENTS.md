# aclif agent integration guide

aclif is an agent-first CLI for governed access to SaaS platforms (Salesforce, ServiceNow, DocuSign, Agentforce, Google Workspace, and any provider added as a plugin).
Every command outputs structured JSON, carries declarative safety metadata, and
supports introspection without execution.

## Quick Start Workflow

```
1. Discover providers     →  aclif discover
2. Learn a provider       →  aclif learn salesforce
3. Inspect a command      →  aclif salesforce data query --schema
4. Preview (optional)     →  aclif salesforce data query --query "SELECT Id FROM Account LIMIT 1" --dry-run
5. Execute                →  aclif salesforce data query --query "SELECT Id, Name FROM Account LIMIT 10"
```

## Introspection Flags

These flags short-circuit execution and return metadata. They bypass
required-flag validation, so you can call `--schema` without providing `--query`.

| Flag | Returns |
|------|---------|
| `--schema` | Full flag/arg definitions + ACI metadata |
| `--examples` | Usage examples with expected response shapes |
| `--shape` | Response structure preview (fields, types, examples) |
| `--discover` | Sibling commands + child topics in current hierarchy |
| `--changelog` | Version history for this command |
| `--flags-for <category>` | Flags filtered by use case: `filtering`, `output`, `pagination`, `auth`, `bulk` |
| `--estimate` | Token cost estimate without executing |

## Base Flags (All Commands)

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | `true` | Output as JSON |
| `--fields` | string | none | Comma-separated fields to return |
| `--dry-run` | boolean | `false` | Preview operation without executing |
| `--estimate` | boolean | `false` | Estimate response size |
| `--diff` | boolean | `false` | Show only changed fields (mutations) |
| `--truncate` | integer | none | Max records to return |
| `--full` | boolean | `false` | Include sensitive values in output |
| `--pretty` | boolean | `false` | Colored output for human reading |
| `--profile` | string | none | Named profile from the config file (or `ACLIF_PROFILE`) |
| `--instance` | string | none | Named instance within the profile, for providers with more than one |
| `--confirm` | boolean | `false` | Confirm a command that requires explicit confirmation |
| `--identity-token` | string | none | Identity token verified by the configured identity provider (or `ACLIF_IDENTITY_TOKEN`) |

## ACI Metadata Contract

Every command declares immutable metadata queryable via `--schema`:

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

- **mutability**: What the command does to the target system
- **blastRadius**: How many records could be affected
- **requiresConfirmation**: If `true`, `--confirm` flag is mandatory
- **idempotent**: Whether running it twice produces the same result
- **reversible**: Whether the effect can be undone

## Auth Resolution

Credentials resolve in this order (first match wins):

1. **CLI flags** (`--instance-url`, `--access-token`, etc.)
2. **Environment variables** (`SF_INSTANCE_URL`, `SF_ACCESS_TOKEN`, etc.)
3. **Config profile** (`--profile <name>` selecting a section of `config.yaml`)

## Response Envelope

### Success

```json
{
  "success": true,
  "result": { ... },
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

Use `_context.nextCommand` to paginate; it contains the exact next command.
Use `_context.refinements` for suggestions on narrowing results.

### Error

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

Use `error.code` for programmatic handling. Use `error.workingExample` to
self-correct.

## Exit Codes

| Code | Meaning | Agent Action |
|------|---------|-------------|
| 0 | Success | Parse stdout JSON |
| 1 | API / runtime error | Check `error.code` in response, retry or adjust |
| 2 | Invalid usage (bad flags) | Fix command syntax, use `--schema` to check |
| 3 | Auth / credential failure | Check credentials, refresh token |
| 130 | SIGINT (interrupted) | Operation may have partially completed |

## Command Topology

```
aclif discover                          # List all providers
aclif learn <provider>                  # Provider briefing (~500 tokens)

salesforce
├── discover                            # List Salesforce objects and topics
├── introspect                          # Deep org schema discovery
├── data
│   ├── query    -q                     # SOQL queries
│   ├── aggregate                       # SOQL aggregate queries
│   ├── describe                        # Object metadata
│   ├── dml      <operation> <object>   # insert/update/delete/upsert
│   ├── search   -q                     # SOSL full-text search
│   └── search-objects                  # Find objects by name
├── metadata
│   ├── object                          # Create/describe custom objects
│   ├── field                           # Create/describe custom fields
│   └── permissions                     # View field-level security
├── apex
│   ├── run                             # Execute anonymous Apex
│   ├── get-class                       # Retrieve Apex class source
│   ├── deploy-class                    # Deploy Apex class
│   ├── get-trigger                     # Retrieve trigger source
│   └── deploy-trigger                  # Deploy trigger
└── debug-log
    └── manage                          # Enable/disable debug logging

servicenow
├── discover                            # List ServiceNow tables
├── introspect                          # Deep table schema discovery
├── data
│   ├── query    -t -q                  # Table queries (encoded query syntax)
│   ├── aggregate -t -q                 # Aggregate queries
│   ├── describe                        # Table/field metadata
│   ├── dml      <operation> -t         # insert/update/delete
│   └── search   -t                     # Full-text search
└── script
    └── run      -c                     # Execute server-side scripts
```

## Safety Guidelines for Agents

1. **Always use `--dry-run` before mutations** on unfamiliar data
2. **Check `blastRadius`** via `--schema` before delete operations
3. **Use `--truncate`** to limit response size and protect context window
4. **Use `--fields`** to request only needed columns
5. **Follow `_context.nextCommand`** for pagination instead of constructing offsets manually
6. **Use `--estimate`** to check token cost before large queries
7. **Never pass `--full`** unless you specifically need unmasked credentials in output
