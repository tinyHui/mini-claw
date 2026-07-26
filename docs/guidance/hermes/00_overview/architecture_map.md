# Architecture Map

## Overview

Hermes is not just a chat loop. It is a long-lived personal assistant runtime with a transcript database, memory substrates, a tool registry, provider abstraction, messaging gateway, TUI control plane, background learning loop, and multiple safety layers. The README frames this as a "self-improving AI agent" with skill creation, self-improvement, FTS5 session search, Honcho user modeling, scheduling, delegation, and multi-platform interaction (`$HERMES/README.md:18`, `$HERMES/README.md:25`, `$HERMES/README.md:27`).

The main architectural pattern is a central `AIAgent` runtime that composes optional capabilities at construction time and delegates specialized behavior to subsystem modules. The constructor accepts provider, model, toolset, memory, gateway, and runtime knobs in one place (`$HERMES/agent/agent_init.py:154`). It then wires in tool definitions, memory stores/providers, guardrail controllers, and provider/client runtime state (`$HERMES/agent/agent_init.py:430`, `$HERMES/agent/agent_init.py:949`, `$HERMES/agent/agent_init.py:1087`).

For a new framework, the transferable kernel should be smaller than Hermes' full application: transcript state, prompt/context assembly policy, model-call loop, tool permission/execution policy, memory injection policy, lifecycle hooks, and observability. Gateway adapters, TUI RPCs, background self-improvement, cron/kanban work orchestration, browser backends, and provider catalogs should attach to that kernel through contracts. Hermes demonstrates the domain boundaries, but its large central modules also show the maintenance cost of letting too many boundaries meet inside one runtime object.

## Code References

- `$HERMES/README.md:18` - product-level statement of self-improving personal assistant scope.
- `$HERMES/README.md:22` - TUI, gateway, learning, scheduling, delegation, and research feature matrix.
- `$HERMES/agent/agent_init.py:154` - `init_agent` accepts the main runtime surface.
- `$HERMES/agent/agent_init.py:430` - runtime state includes tool execution state, guardrails, interrupts, workers, and subagent tracking.
- `$HERMES/agent/agent_init.py:949` - tool definitions are assembled once from the registry/toolset system.
- `$HERMES/agent/agent_init.py:1087` - memory config loading starts.
- `$HERMES/agent/agent_init.py:1131` - external memory provider plugin loading starts.
- `$HERMES/run_agent.py:2955` - external memory sync is called after turns as best-effort side effect.
- `$HERMES/pyproject.toml:24` - core dependencies are exact-pinned.
- `$HERMES/pyproject.toml:117` - optional dependencies are split by feature/provider.
- `$HERMES/agent/system_prompt.py:62` - prompt assembly is split into stable/context/volatile tiers.
- `$HERMES/run_agent.py:533` - context-engine session transition hooks.
- `$HERMES/run_agent.py:610` - session reset covers token, cost, and context-engine state.
- `$HERMES/run_agent.py:2192` - JSON session log persistence exists alongside SQLite.
- `$HERMES/tui_gateway/server.py:2048` - TUI/gateway control plane must track session ID rotation.

## Design and Rationale

Hermes favors a modular monolith over a microservice-first architecture. Most agent-critical invariants remain in-process: conversation loop, tool dispatch, provider fallback, local transcript persistence, prompt assembly, and safety decisions. Optional networked pieces such as Honcho, MCP servers, messaging platforms, browser/cloud tools, and model providers are adapters around the local runtime.

That is a pragmatic choice for a personal assistant:

- Local state can be inspected and repaired without operating external infrastructure.
- Optional capabilities can fail open or fail closed based on their safety profile.
- Tool registration and provider selection stay cheap enough for interactive use.
- A single runtime can serve CLI, TUI, gateway, cron, and subagent contexts.

Dependency policy is part of the architecture. Core dependencies are pinned exactly to control supply-chain drift (`$HERMES/pyproject.toml:24`), while provider-specific and heavy integrations live behind extras/lazy install policy (`$HERMES/pyproject.toml:117`, `$HERMES/pyproject.toml:238`). For a new framework, this is a useful split: ship a small reliable kernel, then let capabilities arrive through optional adapters.

## Integration and Coupling

The strongest coupling points are intentional:

- `AIAgent` owns provider runtime, fallback mutation, prompt cache state, and compression context. Provider profiles and transports describe behavior but do not own the whole lifecycle.
- The transcript database is shared by CLI/TUI/gateway, session search, compression, undo/rewind, and background cleanup.
- Memory providers are connected to session identity, gateway identity, and turn lifecycle. They receive hooks for session switches, rewind, compression, delegation, and turn sync.
- Tool definitions are coupled to enabled toolsets, provider capabilities, memory providers, MCP refresh, and progressive disclosure.
- Guardrails are split: pure per-turn loop decisions live in `agent/tool_guardrails.py`, but command approvals, file safety, and write approvals are enforced close to the relevant tool surfaces.

The least transferable part is the concentration of invariants in very large files. In this checkout, `run_agent.py`, `agent/conversation_loop.py`, `agent/agent_init.py`, `hermes_state.py`, and `tui_gateway/server.py` are all central to correctness. That is workable in an evolved project, but a new framework should avoid starting there. Make lifecycle-owned components explicit: `TranscriptStore`, `PromptAssembler`, `ToolExecutor`, `PermissionBroker`, `MemoryBroker`, `ProviderRouter`, and `InteractionSession`.

## Message Flow

One user message roughly crosses these boundaries:

1. Interaction surface resolves identity, platform, cwd, and session context.
2. Transcript/session state supplies prior active messages.
3. Prompt assembly combines stable instructions, tools, skills, context files, memory, platform hints, and volatile time/memory blocks.
4. Provider transport builds the request and normalizes the response.
5. Tool calls are checked by guardrails/permissions and dispatched through the registry.
6. Tool results re-enter the transcript as lower-trust context.
7. Post-turn hooks update token/cost counters, external memory, background review, session logs, UI status, and gateway state.

The risky transitions are user input to prompt context, untrusted tool output to model context, model tool calls to side effects, memory writes to future prompts, and provider fallback to a different data processor.

## Transferability

| Hermes pattern | Copy into a new framework? | Caveat |
| --- | --- | --- |
| Durable transcript plus active/inactive views | Yes | Pair it with user-visible retention/deletion policy. |
| Tool registry plus toolsets | Yes | Add finer capability grants and trust labels. |
| External memory provider hooks | Yes | Require identity, consent, deletion, export, and stale-recall semantics. |
| Background self-improvement | Later | Only after review, provenance, rollback, and evals exist. |
| Large central runtime object | No | Copy the invariants, not the file-level concentration. |

## External Comparison

Assumption/comparison: Hermes' split between transcript persistence and long-term memory resembles the LangGraph distinction between thread-scoped checkpointers and cross-thread stores, where checkpointers handle conversation continuity and fault tolerance while stores handle user facts/preferences. See LangGraph persistence docs: https://docs.langchain.com/oss/python/langgraph/persistence.

Assumption/comparison: Hermes' stateful-agent design also resembles Letta's view that persistent agents store messages, reasoning/tool calls, and memory beyond the context window, while injecting important memory back into context. See Letta stateful agents: https://docs.letta.com/guides/core-concepts/stateful-agents.

## Lessons for a New Framework

- Treat the agent as a runtime kernel, not a function call wrapper.
- Keep the local transcript and recovery path under your control.
- Make optional integrations describe themselves through narrow contracts.
- Inject external memory and tools only after capability and collision checks.
- Pin the core dependency set and move heavy/provider-specific packages behind extras.
- Document the coupling points rather than pretending the system is fully decoupled.
