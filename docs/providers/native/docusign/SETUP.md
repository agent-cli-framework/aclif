# DocuSign setup

The `docusign` provider uses the eSignature REST API v2.1 with the JWT Grant flow: the CLI signs an assertion with an RSA private key, exchanges it for an access token, and caches that token until it expires. `$BIN` stands for your CLI's binary name.

## Credential path

| Field | Flag and variable | What it is |
|---|---|---|
| Integration key | `--integration-key`, `DS_INTEGRATION_KEY` | the app's client id (a GUID) |
| Impersonated user id | `--user-id`, `DS_USER_ID` | the API Username GUID of the user the app acts as |
| Account id | `--account-id`, `DS_ACCOUNT_ID` | the API Account ID GUID |
| Private key | `--private-key`, `DS_PRIVATE_KEY` | the RSA private key PEM, inline (newlines may be written as `\n`) or `@/path/to/key.pem` |
| Base URI | `--base-uri`, `DS_BASE_URI` | optional; discovered from the user info endpoint on first use; `https://demo.docusign.net` for the developer sandbox |
| Auth server | `--auth-server`, `DS_AUTH_SERVER` | `account-d.docusign.com` (sandbox, the default) or `account.docusign.com` (production) |

## Create the app

1. In the DocuSign developer account (Settings, Apps and Keys), add an app. Copy its **Integration Key**.
2. Under Authentication, choose **Service Integration**, generate an RSA key pair, and save the private key.
3. Add a redirect URI (any valid URL; it is used once for consent).
4. Copy the **API Account ID** and your **User ID** from the same page. The user id is the user the app will impersonate; its permission profile bounds what the CLI can do. A user with Send permission and access to the envelopes in question is enough for reads and `envelopes create`; `envelopes delete` moves envelopes to the recycle bin and needs the corresponding right.
5. Grant consent once, in a browser, as the impersonated user:

```
https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=<integration key>&redirect_uri=<redirect uri>
```

Until consent is granted the token exchange fails with `consent_required`; the CLI prints the exact URL to open.

## Verify

```bash
export DS_INTEGRATION_KEY=... DS_USER_ID=... DS_ACCOUNT_ID=... DS_PRIVATE_KEY=@$HOME/.secrets/docusign.pem
$BIN docusign discover --json                         # base URI, account, envelopes visible
$BIN docusign introspect --json                       # effective permission profile and entity CRUD
$BIN docusign envelopes list --from-date 2026-01-01 --limit 5 --json
```

## Documents

`envelopes create --file <markdown>` renders a Markdown file to the envelope document; write `/sn1/` where the signature should go, or let the CLI append it. `--status created` saves a draft; `--status sent` emails the signer and requires `--confirm`.

## Rotation

Generate a new RSA key pair on the app (the old one keeps working until removed), update `DS_PRIVATE_KEY`, then `$BIN auth logout docusign` so the cached access token is dropped. Moving from sandbox to production means a new app, `DS_AUTH_SERVER=account.docusign.com`, and a fresh consent.

## Errors you will meet

| Code | Cause | Fix |
|---|---|---|
| `CONSENT_REQUIRED` | the impersonated user has not granted consent | open the URL in the error once |
| `AUTHENTICATION_FAILED` | wrong integration key, user id, or private key; wrong auth server for the environment | check the four values; sandbox keys do not work against production |
| `INSUFFICIENT_ACCESS` | the impersonated user lacks the permission | `docusign introspect --json` |
| `ENVELOPE_NOT_FOUND` | wrong envelope id | `docusign envelopes list` |
| `INVALID_REQUEST` | DocuSign rejected the envelope payload | check signer email and name and the document |
