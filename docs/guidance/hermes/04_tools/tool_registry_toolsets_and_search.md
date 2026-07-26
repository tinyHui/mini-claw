# Tool Registry, Toolsets, and Progressive Tool Disclosure

## Overview

Hermes tools are registered through a central registry, then assembled into model-facing schemas based on enabled toolsets, runtime capabilities, plugin/MCP availability, and progressive disclosure settings. This avoids hardcoding a giant tool list in the agent loop.

The key design is a two-layer tool system:

- A stable internal registry for dispatch and collision control.
- A model-facing schema assembly pass that can filter, rewrite, defer, or dynamically generate tool definitions.

## Code References

- `$HERMES/model_tools.py:1` - module doc for self-registering tools.
- `$HERMES/model_tools.py:42` - persistent async event loop bridge.
- `$HERMES/model_tools.py:176` - builtin tool discovery imports.
- `$HERMES/model_tools.py:182` - MCP discovery removed from import side effects to avoid gateway event-loop freeze.
- `$HERMES/model_tools.py:243` - tool definition cache rationale.
- `$HERMES/model_tools.py:272` - cache key includes toolsets, registry generation, config, kanban, and tool-search.
- `$HERMES/model_tools.py:350` - toolset enable/disable computation.
- `$HERMES/model_tools.py:422` - dynamic `execute_code` schema.
- `$HERMES/model_tools.py:464` - browser schema description changed when web refs unavailable.
- `$HERMES/model_tools.py:494` - schema sanitizer.
- `$HERMES/model_tools.py:506` - progressive tool-search assembly.
- `$HERMES/tools/registry.py:1` - registry module doc.
- `$HERMES/tools/registry.py:29` - AST discovery of top-level registrations.
- `$HERMES/tools/registry.py:77` - `ToolEntry` fields.
- `$HERMES/tools/registry.py:151` - thread-safe registry snapshots and generation counter.
- `$HERMES/tools/registry.py:234` - collision/override rules.
- `$HERMES/tools/registry.py:337` - model-facing definitions include checks/dynamic schemas/OpenAI wrapping.
- `$HERMES/tools/registry.py:390` - registry dispatch sanitizes exceptions to JSON.
- `$HERMES/toolsets.py:29` - core tools.
- `$HERMES/toolsets.py:91` - named toolset map.
- `$HERMES/tools/tool_search.py:1` - progressive disclosure design constraints.
- `$HERMES/scripts/LIVETEST_README.md:1` - live tool-search harness.

## Design and Rationale

Registry collision control is a safety feature. Hermes allows MCP-to-MCP replacement in refresh flows but requires explicit override for plugin shadowing (`$HERMES/tools/registry.py:234`). That matters because tool names become authority-bearing language in the prompt. A malicious or accidental plugin should not silently replace `read_file` or `terminal`.

Toolsets make the tool surface legible. Instead of a single boolean per tool, Hermes groups tools into capabilities like web, browser, terminal, memory, delegation, session search, code execution, and skills (`$HERMES/toolsets.py:91`). The agent can be started with only the surfaces relevant to a session.

Progressive tool disclosure reduces prompt bloat by deferring non-core tools behind `tool_search`/describe/call bridge semantics. The design comments explicitly keep core tools visible and make the catalog stateless per assembly (`$HERMES/tools/tool_search.py:1`). This is a useful pattern for personal agents because users may install many integrations, but most turns need only a few.

The missing abstraction is a capability model. Toolsets are coarse: "terminal", "browser", "memory", or "messaging" can contain read-only actions, writes, network sends, credential use, and irreversible side effects. A new framework should classify each tool by risk, data sources, data sinks, idempotency, required grants, and output trust level.

## Integration and Coupling

Tool schemas are coupled to:

- Enabled/disabled toolsets and runtime environment.
- Memory providers, whose tool schemas are injected only when the memory toolset is active.
- MCP discovery, dynamic tool refresh, and registry generation counters.
- Provider API modes, since schemas are sanitized/wrapped for provider compatibility.
- Evaluation harnesses, because deferred tools need live end-to-end tests.

Tool output should be treated as typed context, not just text. Web pages, browser snapshots, MCP resources, retrieved transcript snippets, user-authored files, generated code, and tool errors have different trust levels. Hermes has threat scanning and result sanitization in several places, but a new framework should attach trust labels to tool results and carry them into prompt assembly and memory decisions.

## Progressive Disclosure Failure Modes

| Failure | User impact | New-framework target |
| --- | --- | --- |
| Tool search misses the right tool | Model uses a weaker generic tool | Live evals by task class and fallback hints. |
| Tool bridge adds cognitive steps | Model stops after search/describe | Explicit bridge protocol tests. |
| Hidden tool has higher risk than visible tool | Model discovers powerful actions late | Permission check at call time, not discover time. |
| Deferred schemas lose context | Wrong arguments or bad routing | Tool descriptions with examples and risk metadata. |

## Capability Model Target

For each tool, define read/write/network/message/credential capabilities, allowed paths/hosts/accounts, idempotency, approval policy, output trust, logging policy, and revocation behavior. This should be enforced below the model-facing schema so prompt injection cannot bypass it by choosing another tool path.

Browser and computer-use tools deserve special treatment in that model. Hermes supports local and cloud browser backends, selected through browser provider registry/config (`$HERMES/agent/browser_registry.py:5`, `$HERMES/tools/browser_tool.py:489`). Cloud browser sessions can carry cookies, screenshots, CDP URLs, and remote browsing state; local browser sessions can access local network and profile state. A new framework should treat browser actions as network plus credential plus UI-side-effect capabilities, not just "web read" tools.

## External Comparison

The official MCP docs describe MCP as an open standard for connecting AI applications to external systems, including data sources, tools, and workflows. Hermes' registry and MCP integration show why a local capability registry is still useful even when a standard protocol exists: the host still needs policy, collision control, filtering, and prompt-budget management. See https://modelcontextprotocol.io/docs/getting-started/intro.

Assumption/comparison: Recent MCP tool-description research suggests description quality affects tool choice and cost. Hermes' dynamic schema rewriting and progressive disclosure are aligned with the idea that tool descriptions are not inert documentation; they shape behavior. See https://arxiv.org/abs/2602.14878.

## Lessons for a New Framework

- Separate internal dispatch registry from model-facing schema assembly.
- Track a registry generation counter for cache invalidation.
- Make tool name collisions explicit and auditable.
- Group tools into user-configurable toolsets.
- Keep core tools visible; defer long-tail tools behind a search/describe bridge.
- Test deferred-tool flows against real models, not only unit tests.
