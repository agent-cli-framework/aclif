# Motivation

aclif builds command-line tools for AI agents. This document gives the reasoning behind that design: what an organization needs from an agent that reaches its business systems, where the common approach falls short, and how a command-line tool with the properties aclif specifies meets the need. The README states the conclusion, and this document gives the argument behind it and the sources.

## Two requirements

An organization that puts an agent in front of its business systems needs two things from it. The agent should consume no tokens the work does not need, and a workflow it runs should run the same way every time.

**Tokens.** An agent is a model in a loop. On every turn the model reads its whole context, which holds its instructions, the conversation so far, and a description of every action it may take, and then chooses the next action. Everything in that context is paid for on every turn, in money, in latency, and in the share of the context window left for the work itself. A token spent on something the turn does not use is wasted, and the waste repeats on the next turn.

**Determinism.** A workflow that runs on a schedule or on every new record is part of the organization's operations. It has to be tested before it is trusted, reviewed by someone who can say what it will do, and audited afterwards to show what it did. Each of those requires that the same input produce the same path. A workflow whose path can change between runs cannot be tested in any final sense, cannot be reviewed as a fixed thing, and cannot be audited against an expectation. Security follows from the same property. A workflow that can be steered by what it reads gives its permissions to whoever writes the content it reads.

Both requirements turn on the same variable: the moment at which each decision is made. A decision the model makes at run time costs tokens on every run and can come out differently on every run. A decision made once, at design time, costs nothing afterwards and cannot vary. So the question for any tool an agent uses is how much of the work it lets an author settle in advance, and how cleanly the rest can be supplied at run time by something other than a model.

## What a tool list costs

The Model Context Protocol (MCP) puts a server between an agent and an API. The server publishes a fixed list of tools, the agent's host places every definition on that list into the model's context on every turn, and the model picks one. Anthropic's engineering team reports that an agent connected to thousands of tools processes hundreds of thousands of tokens before it reads the request.

The server's author therefore trades coverage for cost when the server is built. Publishing every operation keeps the whole API reachable, and a full enterprise API is hundreds of definitions, all consumed on every turn. Publishing a handful of broad operations keeps the token count small, and any operation the author left off the list is unreachable: the bulk update, the nested relationship query, the custom field the author never saw. The protocol offers three mitigations. A host can filter the tool list per session, a host can defer loading a definition until the model searches for it, and a server can publish one generic call tool with the API's endpoints as its arguments. Each is a design-time decision made per server by whoever builds or configures it, and each fixes at that moment which operations the agent can ever reach.

An agent that spans several platforms needs a server for each, with its own deployment, its own login, its own grammar, its own error format, and its own names for the same things. The model holds all of them at once, so the context cost grows with the number of platforms, and so does the number of ways a call can go wrong.

## What run-time inference costs

With the model choosing tools at run time, every run loads the definitions, spends inference choosing among them, and spends more composing the arguments, for a choice that was settled the first time the workflow ran. The path can differ from run to run, because the model chose it. Independent research on compiled AI measured 100 percent output reproducibility for workflows executed as generated code, against roughly 95 percent when the model reasons at run time. Salesforce's own benchmark of leading LLM agents on CRM tasks measured roughly 58 percent single-turn success, a rate that is workable for an assistant with a person watching and too low for an unattended hourly job, which runs 730 times a month.

The model also reads everything it retrieves as part of its own context. Instructions hidden in an email, a ticket comment, or a record field can redirect its next call, and that call runs with the agent's full permissions. This is prompt injection, which OWASP lists first among the risks to LLM applications, and it exists because the model is choosing at run time.

Code generation at run time reduces the tokens and keeps the variability. Anthropic's engineering team reports that having the model write code against an API, in place of direct tool calls, cut one workflow from 150,000 tokens to 2,000. Cloudflare's Code Mode presents an API of more than 2,500 endpoints to an agent in roughly 1,000 tokens the same way. In both designs the saving comes from keeping the data out of the model's context, and in both the model still generates the program on every run. The cost is smaller and still paid every time, and the path is still chosen at run time.

For open-ended work, a model that reasons at run time is the right engine, and inference is the price of having one. For a defined workflow, the same inference repeats a decision the author could have made once.

## Design time: choosing the command

aclif moves the decisions to design time. An authoring tool, with a model in the loop and a person reviewing, works through a fixed loop against one command-line tool that covers every provider. Prompt One's Composer runs this loop against its Service CLI, which is built on aclif, and any authoring tool can run the same loop against any aclif CLI. In the commands below, `$BIN` stands for the binary name of the CLI in use.

1. **Discover.** `$BIN discover` lists every provider and whether its credentials are configured. `$BIN learn <provider>` returns a briefing: topics, key fields, query syntax, auth paths, and the instance's own custom objects.
2. **Introspect.** `--schema` returns a command's flags, arguments, and safety metadata. `--examples` returns runnable examples with the responses they produce. `--shape` returns the structure of a successful result. All of these return before the command executes, need no credential, and count against no API quota, so the authoring model loads one command's definition at the moment it needs it and pays nothing for the rest.
3. **Generate.** The authoring tool writes the exact command string into the workflow, the way it would type it at a shell.
4. **Validate.** `--dry-run` previews what a mutation would do, and a sample run returns one JSON envelope whose structure is the same for every command. A failure returns an error that names the fault and the command that fixes it, and where the mistake has a known correction, the corrected input. The loop returns to discovery with that correction and exits only when the command runs clean.

Discovery runs under the author's identity, so the tool shows only the objects and fields the author is entitled to. An unauthorized command cannot be written, let alone deployed.

Take a renewal motion as an example: every morning, find the opportunities closing in the next ninety days, check whether any of those accounts have an open priority-one incident in the service desk, and flag the renewals at risk. The loop above produces two commands, one for the CRM and one for the service desk, both written against the same canonical name for the account, and the workflow joins their results on that name. The judgment at the end, which renewals are at risk, is the one place a model is called, and a workflow with no judgment step calls none.

The loop needs three properties from the tool, and each is a requirement aclif takes on.

- **One grammar.** One command structure, one JSON envelope, and one error vocabulary across every provider. The authoring model holds one grammar however many platforms the workflow touches, so its context stays about the same size whether it reaches one platform or five, and a new platform adds commands without adding grammar.
- **Canonical names.** Each platform names the same business entity differently, and each instance adds custom objects and fields of its own. An alias set, a JSON or YAML file, maps `customer` to `Account` in one Salesforce instance and `core_company` in ServiceNow, and a tenant catalog captured from each instance with `introspect --bootstrap` extends the surface to the objects no specification describes. The author writes in one vocabulary, and `--canonical` resolves it to the native names when the command runs. This is a narrower problem than the one a semantic layer takes on. The mapping is a data file, the decision that two objects are the same entity is made once by a person or an authoring agent comparing two catalogs, and a canonical name the alias set does not know fails locally with `CANONICAL_NOT_FOUND` and the nearest matches before any request leaves the machine.
- **The whole API.** A provider covers every operation the platform documents, with nothing removed for the model's convenience. Scope is decided where a command is bound to an agent, from the command's declared metadata, so leaving an operation out of the provider would only hide it from governance. Most of a provider is a direct translation of the platform's API specification, so a coding agent can generate one and run it through the conformance suite, which keeps full coverage affordable.

The output of design time is a workflow whose calls are fixed strings. Each one has been validated, each can be reviewed by reading it, and none holds a credential.

## Run time: executing without inference

At run time the workflow executes each command string as ordinary code. No tool definition is loaded, no model runs, and nothing the workflow reads can change which command runs next. A prompt injection in an email or a record field can at worst corrupt the output of one bounded model call, and a parameter that call produces still passes every check below. The token cost of the call is zero, and on a morning with no new opportunities the renewal motion spends nothing at all. A hundred runs a day cost the same tokens as one, and the path is the one the author fixed, so testing, review, and audit all refer to a fixed thing.

In Prompt One's measured comparison (July 2026), the same resume-screening agent was built as a skills-based runtime-reasoning agent and as a compiled workflow agent, and both were run against the same fifteen applicants:

| Per run, fifteen resumes scored | Skills-based | Compiled workflow |
|---|---|---|
| Input tokens | 52,646 | 10,383 |
| Output tokens | 9,383 | 4,232 |
| Cost, each stack on its own model | about $0.27 | about $0.025 |

The compiled version consumed about one-fifth of the input tokens and cost roughly one-eleventh as much per run. Of the tokens the skills-based run consumed, the resume text and scoring context were a few thousand. The rest was the system prompt, the tool schemas, and the skill text, reloaded on every run.

The command string holds no credential, no identity, and no policy. The host that executes it supplies all three, and the tool has to be built so that the host can add them without changing the command. The command is chosen at design time and the authority to run it is supplied at run time, and neither side ever holds both.

- **The same command under any host.** The command an author validated from a shell is the same command class a gateway executes in-process. An embedded runtime drives it inside a long-lived process, with connections kept warm and expensive logins cached per instance, so a host serving many agents does not spawn a process and log in again on every call. The README's section on the three ways to run it and [EMBEDDING.md](EMBEDDING.md) describe the deployments.
- **Credentials resolved per request.** The host implements a one-method credential resolver over its own vault. The framework calls it before each command and hands the secret to the provider client and nowhere else, so the secret never reaches the agent, the response, or a log. The agent that submitted the command cannot widen its own scope, because it never held a credential.
- **Identity attached to the invocation.** The host verifies the acting user's identity token and attaches the user and the token's claims to the invocation, where every command, hook, and audit event can read them. A call is attributed to a person even when the target system sees only a shared service account.
- **Policy checked on declared metadata.** Every command declares as data whether it reads, creates, updates, or deletes, how many records it could touch, whether it is reversible, whether it is idempotent, and whether it needs explicit confirmation. The host's policy check reads that data and can refuse the command before its code loads. Prompt One's Service Gateway checks scope, blast radius, denied commands, and write and query constraints from it, and narrows a read by rewriting its filter, all before a credential is resolved.
- **Errors and exit codes that code can act on.** A failure at run time returns the same structured error the author saw at design time, with an exit code that distinguishes a usage error from an authentication failure from a provider fault. Code branches on it. Every run also produces an audit record naming the command as executed, the acting user, the calling agent, and the exit code.

These properties come from the arrangement of the parts, so a security review of the arrangement covers every workflow built on it, and a new workflow adds no new review. Prompt One calls this security by construction, and its two posts on the subject, listed under Sources, follow one command from authoring to execution.

## When the model stays in the loop

Not every task is a defined workflow, and the same tool serves an agent that reasons at run time. Such an agent runs `discover` once, loads a command's definition with `--schema` when it needs it, and pays nothing for the commands it does not use. One grammar keeps its context constant across platforms, canonical names keep its vocabulary constant, and an error that names the fix lets it recover in one turn. The saving is smaller than for a compiled workflow, because inference still runs, but the standing cost of a tool list is gone and the whole API of every provider is reachable. The package includes a skill that tells such an agent how to work, and [USING_WITH_AGENTS.md](USING_WITH_AGENTS.md) covers the install.

## What follows for aclif

Four rules satisfy the requirements above, and every rule in [CONTRACT.md](CONTRACT.md) and [PROVIDER_AUTHORING.md](PROVIDER_AUTHORING.md) derives from one of them.

1. **Commands describe themselves on request.** A command returns its schema, examples, and response structure without credentials and without executing.
2. **Commands declare what they may do.** Mutability, blast radius, reversibility, idempotency, and confirmation are data on the command, and a host can refuse the command from that data before its code is loaded.
3. **The same command runs under any host.** A command behaves identically from a shell, from a scheduler, and from inside a long-lived server, with no model present.
4. **Providers are plugins and the grammar is fixed.** A new system adds commands. It does not add a second way to authenticate, paginate, report errors, or describe itself.

## oclif: the starting point and its limit

aclif is built on [oclif](https://oclif.io), the command-line framework under the Salesforce and Heroku CLIs, taken as an ordinary dependency, unforked and unpatched. oclif parses flags, routes commands through the topic tree, loads the command catalog, and runs the hook lifecycle. aclif's commands are oclif commands, and aclif follows oclif's conventions for contributions and releases where they fit.

oclif was designed for one person running one command: one process, arguments from the shell, output to the terminal, exit when done. The deployment aclif is built for is a gateway that runs the same commands thousands of times for many agents at once, with identity and credentials arriving per request and connections that have to stay open between calls. aclif therefore treats the CLI as a library with a binary attached. It describes every execution as an explicit invocation holding identity, credentials, an output channel, and cancellation, and it drives the same command classes in-process through an embedded runtime. It also turns into data the parts of a command that oclif leaves to prose: safety metadata, introspection that returns before execution, and an exit-code vocabulary. [CONTRACT.md](CONTRACT.md) records each of those additions as a versioned contract.

## Sources

- Anthropic Engineering, [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp). An agent connected to thousands of tools processes hundreds of thousands of tokens before it reads the request, and generating code in place of direct tool calls reduced one workload from 150,000 tokens to 2,000. The code is generated on every run.
- Cloudflare, [Code Mode](https://blog.cloudflare.com/code-mode-mcp/). More than 2,500 endpoints presented to an agent in roughly 1,000 tokens, with the program written by the model on every run.
- Justin Poehnelt, [The MCP Abstraction Tax](https://justin.poehnelt.com/posts/mcp-abstraction-tax/). The expressiveness argument against a fixed tool list, and a proposal for a command-line tool whose documentation loads on demand.
- OWASP, [Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/). Prompt injection is listed first.
- [Compiled AI](https://arxiv.org/abs/2604.05150), arXiv. Measured 100 percent output reproducibility for execution as generated code against roughly 95 percent for run-time reasoning. Its workloads differ from an enterprise workflow, and only the architecture effect is cited here.
- Salesforce AI Research, [CRMArena-Pro](https://arxiv.org/abs/2505.18878), arXiv. Leading LLM agents at roughly 58 percent single-turn success on CRM tasks.
- Prompt One, [*Choosing an Enterprise Agent Architecture*](https://www.promptone.ai/resources/agent-framework/), July 2026. The measured comparison in the table above is in the [cost detail](https://www.promptone.ai/resources/agent-framework/#sec-cost-detail) section.
- Prompt One, [*Enterprise Agents, Compiled*](https://www.promptone.ai/resources/downloads/?doc=enterprise-agents-compiled) and [*Inside a Compiled Workflow Agent*](https://www.promptone.ai/resources/downloads/?doc=inside-prompt-one). The compiled workflow agent architecture and its implementation, including the discovery loop and the sandbox limits behind the bounded-injection property.
- Prompt One, [*Your Agent Should Never Choose Its Own Tools*](https://www.promptone.ai/blog/agent-should-never-choose-its-own-tools/) and [*Your Agent Should Never Hold a Credential*](https://www.promptone.ai/blog/agent-should-never-hold-a-credential/), September 2026. One command followed through design-time authoring and run-time execution.
