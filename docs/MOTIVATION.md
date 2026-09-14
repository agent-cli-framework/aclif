# Motivation

An organization that puts an AI agent in front of its business systems wants two things from it. It should spend no tokens it does not need to spend, and a workflow it runs should run the same way every time. aclif exists to make both possible at once. This document states that incentive, shows where the common approach falls short of it, and then describes how a workflow agent built with aclif meets it: compiled at design time, executed at run time with no inference. Published work that reached the same conclusions is cited at the end. The README summarizes the conclusion; this is the reasoning behind it.

## The incentive: no unnecessary tokens, and deterministic execution

**Tokens.** An agent is a model in a loop. On every turn the model reads its whole context, which holds its instructions, the conversation so far, and a description of every action it may take, and then chooses the next action. Everything in that context is paid for on every turn, in money, in latency, and in the share of the context window left for the work. A token spent on something the turn does not use is a token wasted, and the waste repeats on the next turn.

**Determinism.** A workflow that runs on a schedule or on every new record is a piece of the organization's operations. It has to be tested before it is trusted, reviewed by someone who can say what it will do, and audited afterwards to show what it did. Each of those requires that the same input produces the same path. A workflow whose path can change between runs cannot be tested in any final sense, cannot be reviewed as a fixed thing, and cannot be audited against an expectation. Security follows from the same property: a workflow that can be steered by what it reads is a workflow whose permissions belong to whoever writes the content it reads.

The two wants meet at one question: when is each decision made? A decision the model makes at run time costs tokens on every run and can come out differently on every run. A decision made once, at design time, costs nothing afterwards and cannot vary. So the question for any tool an agent uses is how much of the work it lets an author settle in advance.

## Where MCP and run-time inference fall short

**A published tool list is a standing charge.** An MCP server publishes a fixed list of tools, and the agent's host places every definition on the list into the model's context on every turn, whether or not that turn uses it. The server's author therefore has to trade coverage for cost when the server is built. Publishing every operation keeps the whole API reachable and charges for all of it on every turn; a full enterprise API is hundreds of definitions. Publishing a handful of broad operations keeps the charge small and removes everything the author did not anticipate: the bulk update, the nested relationship query, the custom field the author never saw. Three mitigations exist inside the protocol. A host can filter the tool list per session, a host can defer loading a definition until the model searches for it, and a server can publish one generic call tool with the API's endpoints as its arguments. Each is a design-time decision made per server by whoever builds or configures it, and each fixes at that moment which operations the agent can ever reach.

**Each platform brings its own everything.** An agent that spans several platforms needs a server for each, with its own deployment, its own login, its own grammar, its own error format, and its own names for the same things. The model holds all of them at once, so the standing charge grows with the number of platforms, and so does the number of ways a call can go wrong.

**Run-time inference pays for the same decision on every run.** With the model choosing tools at run time, every run loads the definitions, spends inference choosing among them, and spends more composing the arguments, for a choice that was settled the first time the workflow ran. The path can differ from run to run, because the model chose it. And a model that chooses its next call while reading content from outside can be steered by that content: text in an email, a ticket comment, or a record field can redirect the next call, which then runs with the agent's full permissions. This is prompt injection, and it exists because the model is choosing at run time.

**Code generation at run time reduces the tokens and keeps the variability.** Anthropic's engineering team and Cloudflare have each shown that having the model write code against an API, instead of calling tools one at a time, cuts the per-run token count by one to two orders of magnitude. In both designs the model still generates the code on every run, so the cost is smaller but still paid every time, and the path is still chosen at run time.

An agent built this way pays the standing charge for its tool list, pays inference on every run, and cannot promise the same path twice. For an open-ended task that is the price of having a model. For a defined workflow it is waste and risk with nothing bought in return.

## Design time: compiling a workflow agent with aclif

aclif moves the decisions to design time. An authoring tool, with a model in the loop and a person reviewing, works through a fixed loop against one command-line tool that covers every provider.

1. **Discover.** `$BIN discover` lists every provider and whether its credentials are configured. `$BIN learn <provider>` returns a briefing: topics, key fields, query syntax, auth paths.
2. **Introspect.** `--schema` returns a command's flags, arguments, and safety metadata. `--examples` returns runnable examples with the responses they produce. `--shape` returns the structure of a successful result. All of these return before the command executes, need no credential, and count against no API quota, so the authoring model loads one command's definition at the moment it needs it and pays nothing for the rest.
3. **Generate.** The authoring tool writes the exact command string into the workflow, as a string, the way it would type it at a shell.
4. **Validate.** `--dry-run` previews what a mutation would do. A sample run returns one JSON envelope whose structure is the same for every command. A failure returns an error that names the fault and the command that fixes it, and where the mistake has a known correction, the corrected input. Validation is mechanical.

Several properties of the tool make this loop work, and each is a requirement aclif takes on.

- **One grammar.** One command structure, one JSON envelope, one error vocabulary across every provider. The authoring model holds one grammar however many platforms the workflow touches, so its context stays about the same size whether it reaches one platform or five, and a new platform adds commands without adding grammar.
- **Canonical names.** Each platform names the same business entity differently, and each instance adds custom objects and fields of its own. An alias set maps `customer` to `Account` in one Salesforce instance and `core_company` in ServiceNow, and a tenant catalog captured from the instance itself extends the surface to the objects no specification describes. The author works in one vocabulary; the native names stay reachable.
- **The whole API.** A provider covers every operation the platform documents, with nothing removed for the model's convenience. Scope is decided where a command is bound to an agent, from the command's declared metadata, so leaving an operation out of the provider would only hide it from governance.
- **Discovery under the author's identity.** Introspection against a live instance shows only the objects and fields the author is entitled to, so an unauthorized command cannot be written in the first place.

The output of design time is a workflow whose calls are fixed strings, each one validated, each one reviewable by reading it, and none holding a credential.

## Run time: executing without inference

At run time the workflow executes each command string as ordinary code. No tool definition is loaded, no model runs, and nothing the workflow reads can change which command runs next. The token cost of the call is zero, and on a day with no new work the workflow spends nothing at all. The path is the one the author fixed, so testing, review, and audit all have a fixed thing to refer to.

What the run-time host adds is authority and governance, and the tool has to be built so that the host can add them without changing the command.

- **The same command under any host.** The command an author validated from a shell is the same command class the runtime executes in-process. aclif is a library with a binary attached: every execution is an explicit invocation holding identity, credentials, policy, and an output channel, and an embedded runtime drives the same command classes inside a long-lived process, with connections kept warm and expensive logins cached per instance.
- **Credentials and identity injected at execution.** The stored command string holds no secret. A gateway resolves the credential from the organization's vault per request, verifies the acting user's identity token, and attaches both to the invocation. The agent that submitted the command never holds a provider credential and cannot widen its own scope.
- **The command is the unit of authorization.** Every command declares as data whether it reads, creates, updates, or deletes, how many records it could touch, whether it is reversible, whether it is idempotent, and whether it needs explicit confirmation. A policy gate reads that data and can refuse the command before its code loads. The same data demands `--confirm` where the metadata says so and gives the audit line something uniform to record: the command, the user, and the exit code, on every run, even when the target system saw only a shared service account.
- **Errors that code can act on.** A failure at run time returns the same structured error the author saw at design time, with an exit code that distinguishes a usage error from an authentication failure from a provider fault. Code branches on it; nothing has to be read as prose.

## When the model stays in the loop

Not every task is a defined workflow, and the same tool serves an agent that reasons at run time. Such an agent runs `discover` once, loads a command's definition with `--schema` when it needs it, and pays nothing for the commands it does not use. One grammar keeps its context constant across platforms, canonical names keep its vocabulary constant, and an error that names the fix lets it recover in one turn. The saving is smaller than for a compiled workflow, because inference still runs, but the standing charge for a tool list is gone and the whole API of every provider is reachable.

## What follows for aclif

Four rules satisfy the requirements above, and every rule in [CONTRACT.md](CONTRACT.md) and [PROVIDER_AUTHORING.md](PROVIDER_AUTHORING.md) derives from one of them.

1. **Commands describe themselves on request.** A command returns its schema, examples, and response structure without credentials and without executing.
2. **The command is the unit of authorization.** What a command may do is declared as data on the command, and a gate can refuse it before its code is loaded.
3. **The same command runs under any host.** A command behaves identically from a shell, from a scheduler, and from inside a long-lived server, with no model present.
4. **Providers are plugins. The grammar is fixed.** A new system adds commands. It does not add a second way to authenticate, paginate, report errors, or describe itself.

## External validation

Others have reached the same conclusions by measurement or in practice. [The MCP Abstraction Tax](https://justin.poehnelt.com/posts/mcp-abstraction-tax/) makes the expressiveness argument and proposes a command-line tool whose documentation loads on demand. Anthropic's [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) reports that an agent connected to thousands of tools processes hundreds of thousands of tokens before it reads the request, and that generating code in place of direct tool calls reduced one workload from 150,000 tokens to 2,000; Cloudflare's [Code Mode](https://blog.cloudflare.com/code-mode-mcp/) presents more than 2,500 endpoints in roughly 1,000 tokens the same way. Both still generate the code on every run. Compiled workflow agents, as described in the Prompt One [whitepaper](https://www.promptone.ai/resources/agent-framework/), fix their CLI commands at design time and so run with no inference cost for data access.

## CLI Foundations

aclif is built on oclif, the command-line framework under the Salesforce and Adobe CLIs. It is included as an ordinary dependency, unforked and unpatched. aclif uses `@oclif/core` to parse flags, route commands through its topic tree, load the command catalog, and run the hook lifecycle. aclif's commands are oclif commands. aclif also adopts oclif's conventions for how a CLI project accepts contributions and ships releases, where they fit.

However, oclif does not support the deployment aclif requires. It is designed for one person running one command: one process, arguments from the shell, output to the terminal, exit when done. The preferred deployment for aclif is inside an enterprise security gateway, which runs the same commands thousands of times for many agents at once, with identity and credentials arriving per request and connections that have to stay open between calls. 

aclif therefore treats the CLI as a library with a binary attached. aclif describes every execution as an explicit invocation that holds identity, credentials, an output channel, and cancellation, and it drives the same command classes in-process through an embedded runtime. aclif also turns into data the parts of a command that oclif leaves to prose: safety metadata, introspection that returns before execution, and exit codes that distinguish a usage error from an authentication failure from a provider fault. [CONTRACT.md](CONTRACT.md) records those additions as versioned contracts.
