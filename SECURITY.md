# Security

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's security advisory form for this repository ("Report a vulnerability" under the Security tab). Include the version, the provider involved if any, and steps to reproduce. You will get an acknowledgement within three business days and a fix or a mitigation plan within thirty days for confirmed issues. Please do not open a public issue.

## What is in scope

- The framework (`src/core`, `src/cli`), the reference binary, and the embedded runtime.
- Native and contributed providers under `src/providers/`.
- The published npm package and the release workflow.

Private-tier providers in forks are the fork's responsibility.

## How credentials are handled

- Credentials reach a provider through its credential schema only: flags, environment variables, or a profile in the config file. Provider code never reads the environment or the config file itself, and the conformance suite (`C-SEC-1`) checks that.
- Profile values can reference a secret elsewhere (`{env}`, `{file}`, `{exec}`) so the config file need hold none. A literal secret in a config file other users can read produces a warning.
- Output masks values under keys that look like passwords, secrets, tokens, or keys unless `--full` is passed. Error messages never echo a secret field's value.
- Sessions (a session token and its expiry, never a credential) are cached under the user's cache directory with mode `0600`; `auth logout` clears them.
- Every command writes an audit line to stderr with the resolved identity, the command, the exit code, and the error code.

## Supported versions

The latest minor release receives security fixes. Fixes are released as patch versions and noted in the CHANGELOG with the advisory reference.
