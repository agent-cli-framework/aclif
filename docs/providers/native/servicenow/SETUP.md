# ServiceNow setup

The `servicenow` provider uses the Table API, the Aggregate API, `sys_db_object` and `sys_dictionary` for schema, `sys_choice` for choice lists, and (for `script run`) background script execution. `$BIN` stands for your CLI's binary name.

## Credential paths

| Path | Fields | When to use it |
|---|---|---|
| OAuth2 bearer token | `--instance-url` + `--access-token` (`SN_INSTANCE_URL`, `SN_ACCESS_TOKEN`) | you mint tokens elsewhere (an OAuth application registry entry, an embedding host) |
| HTTP Basic | `--instance-url` + `--sn-username` + `--sn-password` (`SN_USERNAME`, `SN_PASSWORD`) | a dedicated integration user |

`--instance-url` is `https://<instance>.service-now.com` with no trailing slash.

## An integration user

1. User Administration, Users, New. Tick **Web service access only** so the account cannot log in to the UI.
2. Roles: `itil` (or `snc_read_only` plus the table roles you need) for records; `personalize_dictionary` or `admin` is needed to read `sys_dictionary` and `sys_db_object` for `data describe` and the tenant walk. `script run` needs `admin` or the script execution permission and is gated behind `--confirm` and the `code_exec` capability.
3. ACLs decide what the user sees per table and field; `$BIN servicenow introspect --json` probes read, create, update, and delete on the core ITSM tables and reports the effective answer.

## Verify

```bash
export SN_INSTANCE_URL=https://dev00000.service-now.com SN_USERNAME=api.user SN_PASSWORD='...'
$BIN servicenow discover --json
$BIN servicenow introspect --json
$BIN servicenow introspect --bootstrap --json         # core tables plus every u_ and x_ table
$BIN servicenow data query --table incident --query "active=true^priority=1" --limit 3 --json
```

## Developer instances

Personal developer instances hibernate after a period without traffic and answer every request with an HTML wake-up page. The CLI reports it as `hibernating`; open the instance in a browser, wait for it to wake, and retry.

## Rotation

Change the user's password (or mint a new OAuth token), update the stored value, done: the provider caches no session.

## Errors you will meet

| Code | Cause | Fix |
|---|---|---|
| `AUTHENTICATION_FAILED` | wrong user or password, expired token | check the values |
| `INSUFFICIENT_ACCESS` | an ACL denies the table or field | `servicenow introspect --json`; adjust roles |
| `RECORD_NOT_FOUND` | wrong `sys_id` | `servicenow data query` to find it |
| `INVALID_TABLE` | a table that does not exist on this instance | `servicenow discover --json` or the tenant catalog |
| `INVALID_QUERY` | encoded query syntax | `field=value^field2!=value2`; operators `=`, `!=`, `LIKE`, `>`, `<`, `>=`, `<=` |
