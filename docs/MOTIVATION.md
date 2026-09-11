# Motivation

aclif exists because of two published arguments about how an AI agent should reach external services. This document restates each argument, with links to the source, and then states what the two together require of a CLI framework. The README summarises the conclusion; this is the reasoning behind it.

## Argument one: every abstraction layer between an agent and an API loses fidelity

Source: Justin Poehnelt, [The MCP Abstraction Tax](https://justin.poehnelt.com/posts/mcp-abstraction-tax/), March 2026.

Poehnelt describes three layers between an agent and the data it wants: the tool definitions a protocol server publishes, the REST API those tools wrap, and the storage underneath the API. Each layer loses something, and the losses compound. His central sentence is: "Every layer between the user's intent and the API loses fidelity. MCP adds a layer. That layer costs you expressiveness."

A tool server has two ways to publish an API, and both cost something.

- **Constrained tools.** A handful of high-level operations, such as `update_opportunity`, that are easy for a model to call. Bulk operations, nested relationships, and anything the tool author did not anticipate cannot be expressed at all.
- **Full-surface exposure.** One tool per endpoint, preserving everything the API can do. Every one of those tool definitions occupies the agent's context on every turn, and for any given task nearly all of them are irrelevant.

Enterprise APIs make the problem worse before the protocol layer is added. CRM APIs were designed for human developers and carry opaque identifiers, polymorphic custom fields, and deeply nested structures. Wrapping an already difficult API in a lossy abstraction compounds the difficulty.

Poehnelt's alternative is a command-line tool whose documentation loads on demand. An agent asks a command for its help text when it needs that command, so the full surface is available and the context cost is paid only for what is used. In his words, "you don't need to load everything at once." He places the options on a spectrum from constrained tool servers through full-surface tool servers and CLIs to raw API access, and concludes that the useful work is understanding what each position costs.

**What this requires of aclif.** The full API surface of every provider, with no operation removed for the model's convenience. Introspection on every command, so an agent learns a command's flags, examples, and output structure at the moment it needs them and pays nothing for the rest. Canonical names as an alias layer over the native names, so the native identifiers Poehnelt describes remain reachable while an agent can also work in one vocabulary across providers.

## Argument two: an agent should not choose its own tools at run time

Source: Prompt One, [Your Agent Should Never Choose Its Own Tools](https://www.promptone.ai/blog/agent-should-never-choose-its-own-tools/), September 2026, and its companion, [What Happens When You Compile an Enterprise Workflow](https://www.promptone.ai/blog/enterprise-agents-compiled/), July 2026.

The post starts from the premise that "security and governance begin with its design and implementation, long before it is deployed or runs." It contrasts two architectures. A runtime-reasoning agent relies on the model to decide which tool to call and with which arguments on every run. A compiled workflow agent makes those decisions once, at design time, under the author's identity, and runs afterwards as ordinary code. For a workflow that runs on a schedule or on every new record, the post argues that the commands should be chosen, validated, and fixed at design time.

Letting a model pick tools per call has three costs.

1. **Tokens.** Every tool definition occupies context before any work begins. Anthropic's engineering team [reports](https://www.anthropic.com/engineering/code-execution-with-mcp) that an agent connected to thousands of tools processes hundreds of thousands of tokens before it reads the request.
2. **Variability.** The model chooses the tool and its arguments at run time, so "the same job can take a different path today than it took yesterday."
3. **Exposure at execution.** The agent holds a live credential for each system, and a tool returns whatever the API returns with no filtering. Instructions hidden in an email, a ticket comment, or a record field can redirect the agent's next call, which then runs with the agent's full permissions. This is prompt injection, listed by [OWASP](https://genai.owasp.org/llm-top-10/) as a top risk for LLM applications.

The alternative the post describes is one command-line tool that covers every endpoint of every API with the same grammar and semantics for all of them. Commands describe themselves on request with their schema, worked examples, and output structure. Every command declares what it is safe to do before it runs. Every error explains itself in a form the agent can act on. Records are addressed by canonical name, so an account in the CRM and the same account in the service desk share one name.

At design time, an authoring agent works through a fixed loop against that tool: **discover** the providers and commands that exist, **introspect** the chosen command's flags and examples, **generate** the exact command into the workflow code, and **validate** it by running a sample preview. Discovery runs under the author's identity and shows only the objects and fields the author is entitled to, so, in the post's words, "an unauthorized query cannot be written, let alone compiled." The acting user's identity is injected at execution; the generated code never holds it.

The post quantifies the cost difference. Anthropic measured a 98.7 percent token reduction, from 150,000 to 2,000, when direct tool calls were replaced with generated code. Cloudflare's [Code Mode](https://blog.cloudflare.com/code-mode-mcp/) presented an API of more than 2,500 endpoints in roughly 1,000 tokens. In both cases the model still generates the code on every run. A compiled agent generates it once. In Prompt One's own [measured comparison](https://www.promptone.ai/resources/agent-framework/#sec-cost-detail) of the same resume-screening agent built both ways, the compiled version used 10,383 input tokens per run against 52,646 and cost roughly 11 times less. On a day with no new work it used none.

**What this requires of aclif.** Safety metadata declared as data on every command, so a policy gate can refuse a command before its code loads. A structured envelope on every result and a structured error with a corrective hint, so validation at design time is mechanical. Introspection that works without credentials, so discovery touches no production system. An embedded runtime, so the same command classes that an author validates from a shell run inside a gateway that holds the credentials and injects identity per request.

## What the two arguments require together

Both arguments describe the same interface from different directions. Poehnelt asks for fidelity and on-demand cost. Prompt One asks for design-time fixing and run-time governance. Four principles satisfy both, and every rule in [CONTRACT.md](CONTRACT.md) and [PROVIDER_AUTHORING.md](PROVIDER_AUTHORING.md) derives from one of them.

1. **Commands describe themselves on request.** A command returns its schema, examples, and response structure without credentials and without executing. This is Poehnelt's on-demand loading and the discovery loop's first two steps.
2. **The command is the unit of authorization.** What a command may do is declared as data on the command, and a gate can refuse it before its code is loaded. This is where the Prompt One post's "validated for scope" happens.
3. **The same command runs under any host.** A command behaves identically from a shell, from a scheduler, and from inside a long-lived server, with no model present. The author validates it in one host and the gateway runs it in another.
4. **Providers are plugins. The grammar is fixed.** A new system adds commands. It does not add a second way to authenticate, paginate, report errors, or describe itself. One grammar is what lets an agent learn the tool once and what lets canonical names span providers.

## oclif: the starting point and its limit

oclif, the framework under the Salesforce and Heroku CLIs, is the starting point, and the name aclif is one letter away from it deliberately. oclif is an ordinary dependency, unforked and unpatched. It parses every flag, routes every command through its topic tree, loads the catalogue from a build-time manifest, and runs the hook lifecycle. aclif's commands are oclif commands. oclif also brought a mature set of conventions for how a CLI project accepts contributions and ships releases, which aclif adopts where they fit.

oclif does not supply the third principle. It is designed for one person running one command: one process, arguments from the shell, output to the terminal, exit when done. The gateway described in the Prompt One post runs the same commands thousands of times for many agents at once, with identity and credentials arriving per request and connections that must stay open between calls. The first version of that gateway spawned a process per command, and a modest seed job took minutes, most of it process startup and repeated logins.

aclif therefore treats the CLI as a library with a binary attached. Every execution is described by an explicit invocation carrying identity, credentials, output channel, and cancellation, and an embedded runtime drives the same command classes in-process. The parts of a command that oclif leaves to prose became data: safety metadata, introspection that returns before execution, and exit codes that distinguish a usage error from an authentication failure from a provider fault. [CONTRACT.md](CONTRACT.md) records those additions as versioned contracts.
