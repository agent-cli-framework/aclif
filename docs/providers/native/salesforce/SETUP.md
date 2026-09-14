# Salesforce setup

The `salesforce` provider talks to the REST, SOAP login, Tooling, and Metadata APIs of one org. `$BIN` stands for your CLI's binary name.

## Credential paths

| Path | Fields | When to use it |
|---|---|---|
| Session token | `--instance-url` + `--access-token` (`SF_INSTANCE_URL`, `SF_ACCESS_TOKEN`) | you already hold a session id or OAuth access token, for example from `sf org auth show-access-token -o <org> --json` (`sf org display` redacts it) or an embedding host. A security token is not a session token; it belongs on the username and password path |
| Username and password | `--instance-url` + `--sf-username` + `--sf-password` (+ `--security-token`, `--login-url`) (`SF_USERNAME`, `SF_PASSWORD`, `SF_SECURITY_TOKEN`, `SF_LOGIN_URL`) | an integration user with API access; the CLI performs the SOAP login once and caches the session |
| OAuth client credentials | `--instance-url` + `--client-id` + `--client-secret` (`SF_CLIENT_ID`, `SF_CLIENT_SECRET`) | a Connected App or External Client App with the client credentials flow enabled and a run-as user |

`--instance-url` is the org's My Domain URL with `https://` and no trailing slash, for example `https://example.my.salesforce.com`. A trailing slash produces an `INVALID_LOGIN` that looks like a wrong password.

## Username and password

1. Create or pick an integration user with the **API Enabled** permission and read access to the objects the agent will use. For the tenant walk (`introspect --bootstrap`) read access to the objects is enough; no write permission is needed.
2. The password must be paired with the user's **security token**. Salesforce emails a new token whenever the password changes, and the old one stops working at that moment (Settings, Reset My Security Token). Updating the password without the token fails `INVALID_LOGIN`.
3. `--login-url` (`SF_LOGIN_URL`) defaults to `https://login.salesforce.com`. Use `https://test.salesforce.com` for a sandbox, or the My Domain URL.

## OAuth client credentials

1. Setup, App Manager, New Connected App (or External Client App Manager). Enable OAuth, add the `api` and `refresh_token, offline_access` scopes, and enable **Client Credentials Flow**.
2. On the app's OAuth Policies, set a **Run As** user; that user's permissions bound what the CLI can do.
3. Wait about ten minutes after saving before the consumer key works.
4. The token endpoint is `<instance-url>/services/oauth2/token`; set `--login-url` only if the token endpoint lives on a different host.

## Verify

```bash
export SF_INSTANCE_URL=https://example.my.salesforce.com SF_USERNAME=api.user@example.com SF_PASSWORD='...' SF_SECURITY_TOKEN='...'
$BIN salesforce discover --json                       # org id, API version, custom objects
$BIN salesforce introspect --json                     # what the credentials can do per object
$BIN salesforce introspect --bootstrap --json         # capture the tenant catalog (custom objects + core objects)
$BIN salesforce data query --query "SELECT Id, Name FROM Account LIMIT 3" --json
```

`$BIN auth status --json` shows the cached session; `$BIN auth logout salesforce` forces the next command to log in again.

## Rotation

Change the password, collect the new security token, update both values wherever they are stored (the profile, the environment, or the host's vault), then `$BIN auth logout salesforce`. For the OAuth path, rotate the consumer secret in the app (Manage Consumer Details, Rotate Secret) and update `SF_CLIENT_SECRET`.

## Errors you will meet

| Code | Cause | Fix |
|---|---|---|
| `AUTHENTICATION_FAILED` | expired session, wrong password or token, trailing slash on the instance URL | check the three values, then `auth logout` |
| `INSUFFICIENT_ACCESS` | the user lacks object or field permission | `salesforce introspect --json` shows per-object CRUD |
| `RATE_LIMITED` (`REQUEST_LIMIT_EXCEEDED`) | the org's rolling 24-hour API allocation is spent | wait, or narrow the query; `apiCallsConsumed` in `--schema` helps budget |
| `INVALID_FIELD`, `INVALID_OBJECT`, `MALFORMED_QUERY` | SOQL against a name the org does not have | `salesforce data describe <Object> --json`; the tenant catalog lists custom names |
| `SOQL_AGGREGATE_ALIAS_ORDER_BY` | `ORDER BY` on an aggregate alias | the error carries `correctedValue`; resend it |
