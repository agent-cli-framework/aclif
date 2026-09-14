# Using aclif with agents

An agent that reads or changes records in Salesforce, ServiceNow, DocuSign, Agentforce, or Google Workspace does so by running `aclif` commands as a subprocess and parsing the JSON on stdout. The credentials stay on the host, every call goes through the policy layer, and an audit line names the person behind each call.

The instructions the agent needs are packaged as a skill in [`skills/aclif/`](../skills/aclif/): [`SKILL.md`](../skills/aclif/SKILL.md) is the workflow and the rules, and [`reference.md`](../skills/aclif/reference.md) is the flag list, envelope, exit codes, and command topology. The skill is included in the npm package.

## Install the skill

Claude Code loads a skill from `.claude/skills/<name>/SKILL.md` in the project or from `~/.claude/skills/<name>/SKILL.md` for the user. Copy the directory to either place:

```bash
# from the installed package
cp -r "$(npm root -g)/@aclif/core/skills/aclif" ~/.claude/skills/aclif

# or from a checkout
cp -r skills/aclif ~/.claude/skills/aclif
```

Other agent runtimes that follow the same skill format read the same files. For a runtime with no skill support, put the contents of `SKILL.md` in the agent's system prompt and keep `reference.md` where the agent can read it.

The binary itself must be on the agent's PATH, with credentials in the environment or a profile; see [CONFIGURATION.md](CONFIGURATION.md). The repository [Dockerfile](../Dockerfile) builds a container with the binary and nothing else, for agent sandboxes that cannot install Node.

## A CLI built from aclif

A CLI scaffolded from aclif has its own binary name and environment-variable prefix. Copy the skill directory under that name and replace `aclif` with the binary name in both files. The grammar, the envelope, and the rules are unchanged.

## A fixed workflow

For an agent that executes a defined workflow, do the discovery once. Run `learn`, `--schema`, and `--examples` at design time, embed the exact command string in the workflow, and the agent executes it at run time as ordinary code, with no model in the loop and no inference cost for the call.
