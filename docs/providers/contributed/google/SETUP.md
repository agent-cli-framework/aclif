# Google Workspace setup

The `google` provider covers Gmail and Google Calendar through their REST APIs. It is a contributed provider, maintained by the handles in `plugin.maintainers`. `$BIN` stands for your CLI's binary name.

## Credential paths

| Path | Fields | When to use it |
|---|---|---|
| OAuth2 refresh token | `--gw-client-id` + `--gw-client-secret` + `--refresh-token` (`GW_CLIENT_ID`, `GW_CLIENT_SECRET`, `GW_REFRESH_TOKEN`) | one mailbox or calendar, consented once by its owner |
| Service account with domain-wide delegation | `--service-account-key` + `--delegated-user` (`GW_SERVICE_ACCOUNT_KEY`, `GW_DELEGATED_USER`) | a Workspace domain, acting as any user the admin delegates |
| Access token | `--access-token` (`GW_ACCESS_TOKEN`) | a short-lived token minted elsewhere (about an hour) |

## OAuth2 refresh token

1. In a Google Cloud project, enable the **Gmail API** and the **Google Calendar API**.
2. APIs and Services, OAuth consent screen: fill in the app name, support email, and developer contact. While the app is in **Testing**, refresh tokens expire after seven days and only listed test users can consent; publishing the app (Audience, Publish app, "In production", unverified is fine) gives long-lived tokens.
3. Credentials, Create OAuth client ID (Web application, with `https://developers.google.com/oauthplayground` as an authorised redirect URI if you mint through the playground).
4. Mint a refresh token with exactly these scopes:

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/calendar.events
```

Do not add `gmail.metadata`: Google enforces the more restrictive scope and it blocks `q=` searches even when `gmail.readonly` is granted. `mail.google.com/` is a restricted scope that requires app verification and is not needed. Changing the scope list invalidates existing tokens.

## Service account

1. Create a service account in the Cloud project and download its JSON key. `GW_SERVICE_ACCOUNT_KEY` holds the JSON content of the key itself; a file path is not accepted.
2. In the Google Admin console, Security, API controls, Domain-wide delegation: add the service account's client id with the five scopes above.
3. `GW_DELEGATED_USER` is the email of the user to act as.

## Verify

```bash
export GW_CLIENT_ID=... GW_CLIENT_SECRET=... GW_REFRESH_TOKEN=...
$BIN google discover --json
$BIN google introspect --json                          # which scopes the credentials can exercise
$BIN google gmail query --query "is:unread" --limit 3 --json
```

## Rotation

Mint a new refresh token (same client, same scopes), replace `GW_REFRESH_TOKEN`; the provider caches no session. A 403 with `insufficientPermissions` after rotation means the new token was minted with fewer scopes.
