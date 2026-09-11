# Configuration

How a standalone CLI built on aclif finds credentials, profiles, aliases, manifests, policy, and identity. Embedding hosts bypass all of this and pass everything per invocation; see [EMBEDDING.md](EMBEDDING.md). `$BIN` stands for the binary name; `<BIN>` for its upper-case form in environment variables (`MYCLI_PROFILE` for a CLI named `mycli`).

## Where things live

| What | Path | Override |
|---|---|---|
| Config file | `~/.config/<dirname>/config.yaml` (`%LOCALAPPDATA%\<dirname>\config.yaml` on Windows) | `XDG_CONFIG_HOME`, or `<BIN>_CONFIG_DIR` for the directory |
| Imported alias sets | `<config dir>/aliases/*.json` or `.yaml` | |
| Session cache | `~/.cache/<dirname>/sessions/<provider>/<instance key>.json`, mode 0600 | `XDG_CACHE_HOME` |
| Tenant catalogue cache | `~/.cache/<dirname>/tenant/<provider>/<instance key>.json` | `XDG_CACHE_HOME` |

`dirname` is the CLI's oclif `dirname`, normally its bin name. `$BIN auth status --json` prints the config file path and the cached sessions.

## Credentials

Every provider declares a credential schema: fields, the flag and environment variable for each, and the accepted paths (which fields together make a working login). `$BIN learn <provider> --json` lists the paths; `$BIN <provider> <command> --flags-for auth` lists the flags.

Resolution order, first match wins:

1. Flags: `--instance-url`, `--access-token`, `--sf-username`, and so on.
2. Environment: `SF_INSTANCE_URL`, `SN_ACCESS_TOKEN`, `DS_PRIVATE_KEY`, and so on.
3. The selected profile in `config.yaml`, keys in snake_case of the field names (`instance_url`, `access_token`).

A command with no working path exits 3 with a `NO_CREDENTIALS` error that lists every path.

## The config file

```yaml
default_profile: dev

profiles:
  dev:
    salesforce:
      instance_url: https://example-dev-ed.develop.my.salesforce.com
      username: user@example.com
      password: {env: SF_DEV_PASSWORD}          # a secret source, see below
      security_token: {file: ~/.secrets/sf-token}
    servicenow:
      instance_url: https://dev00000.service-now.com
      username: api
      password: {exec: "pass show servicenow/dev"}
  staging:
    salesforce:
      instance_url: https://example--staging.sandbox.my.salesforce.com
      access_token: ""                          # empty: fall through to SF_ACCESS_TOKEN

aliases:
  - ./aliases/crm.json
aliases_starter: true

manifests:
  dev:
    salesforce:
      - ./manifests/apex-quote-summary.json

policy:
  require_identity: false
  require_confirm_for: []
  dry_run_warning_for: [filtered_set, all_records]

identity:
  provider: anonymous
```

`config.example.yaml` at the repository root is the annotated version.

### Profiles

`--profile <name>` or `<BIN>_PROFILE` selects one; `default_profile` applies when neither is set; a name that does not exist is a usage error (exit 2). The selected profile is loaded into the environment once per command, before the command runs, so a profile value and an environment value are the same thing to the command. A provider section with keys the provider's schema does not declare produces a warning and the command still runs.

`--instance <alias>` or `<BIN>_INSTANCE` names one instance of a provider for alias resolution and for hosts that keep several; standalone, a profile holds one set of credentials per provider, so keep one profile per instance (`dev`, `dev-acquired`).

### Secret sources

A credential value in a profile may be a literal or one of:

| Form | Behaviour |
|---|---|
| `{env: NAME}` | read `NAME` from the environment; an unset variable is an error that names it |
| `{file: path}` | read the file and trim it; a missing file is an error that names the field, never the path contents; `~` expands |
| `{exec: command}` | run the command, take stdout trimmed; a non-zero exit or a ten-second timeout is an error |

A literal in a `secret` field (password, token, private key) of a config file that other users can read produces one warning on stderr and still runs.

### Alias sets

`aliases` lists alias set files in precedence order (relative to the config directory). Files imported with `$BIN aliases import <file>` land in `aliases/` and load automatically. The starter vocabulary that ships with the framework comes last unless `aliases_starter: false`. With `--canonical`, entity and field names on data commands are resolved through these sets for the command's provider and instance; an unknown canonical name exits 2 with the nearest names.

### Manifests

`manifests.<profile>.<provider>` lists manifest files. Each becomes a command of that provider for that profile, with the manifest's own `aciMetadata`. `$BIN manifests validate <file>` checks one; `$BIN manifests list --json` shows what the selected profile loads. `<BIN>_NO_MANIFESTS=1` disables loading. The provider must declare an `http` adapter; the built-in Salesforce, ServiceNow, DocuSign, and Agentforce providers do.

### Policy

| Key | Default | Meaning |
|---|---|---|
| `require_identity` | `false` | refuse commands with no resolved identity (exit 3) |
| `require_confirm_for` | `[]` | require `--confirm` by mutability (`create`, `update`, `delete`), blast radius (`single_record`, `filtered_set`, `all_records`), or capability (`code_exec`, `metadata_change`, `bulk`); commands that declare `requiresConfirmation` always require it |
| `dry_run_warning_for` | `[filtered_set, all_records]` | warn when a delete of that blast radius runs without `--dry-run` |

Introspection flags and `--dry-run` are exempt from confirmation.

### Identity

`identity.provider: anonymous` (default) resolves no identity; the audit line shows `user: null`. `static-jwt` verifies `--identity-token` or `<BIN>_IDENTITY_TOKEN` as an HS256 JWT against `<BIN>_IDENTITY_SECRET`, maps `sub` to the user id, and rejects tampered or expired tokens. Embedding hosts supply identity on the invocation instead.

## Environment variables the framework reads

| Variable | Meaning |
|---|---|
| `<BIN>_PROFILE` | profile to select |
| `<BIN>_INSTANCE` | instance alias |
| `<BIN>_IDENTITY_TOKEN`, `<BIN>_IDENTITY_SECRET` | static JWT identity |
| `<BIN>_NO_MANIFESTS` | `1` disables manifest loading |
| `<BIN>_CONFIG_DIR` | config directory override (oclif) |
| `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` | base directories |
| `FORCE_COLOR` | colour for `--pretty` when stdout is not a terminal |

The framework's own names (`ACLIF_PROFILE`, and so on) also work for any CLI, as a fallback. Provider credential variables are declared by each provider and do not change with the CLI's name.

## Sessions

Providers whose login is expensive (Salesforce username and password, DocuSign JWT grant) cache the resulting session under the cache directory, keyed by provider, instance URL, identity, and auth type. The next command reuses it without logging in; a 401 invalidates it. `$BIN auth status --json` lists cached sessions without their secrets; `$BIN auth logout [provider]` clears them.

## Tenant catalogue

`$BIN <provider> introspect --bootstrap` walks the instance's custom entities plus the provider's core entities and caches the catalogue; `--refresh` recaptures; `--all` widens the walk to every entity. `learn` and `--schema` then list the instance's entities. The catalogue holds names, types, labels, enumerations, and relationships, never record data.
