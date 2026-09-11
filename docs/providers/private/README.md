# private tier

This directory is fork-owned. Upstream commits nothing here except this
README, and upstream CI rejects any pull request that touches it
(`scripts/check-sync-boundary.mjs`). A fork adds providers, tests,
fixtures, and setup docs under this prefix and pulls upstream without
merge conflicts; contributions go upstream from a branch cut from
`upstream/main`, never from a branch that carries this directory's
contents. See `docs/FORKING.md`.
