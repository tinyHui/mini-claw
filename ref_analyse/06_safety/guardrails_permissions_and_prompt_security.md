# Guardrails, Permissions, and Prompt Security

## Overview

Hermes uses layered safety controls instead of one global "safe mode": tool-loop guardrails, dangerous command approvals, write denied paths, read denied paths, prompt-injection scanning, MCP metadata scanning, provider tool-shadow prevention, and write approval staging for memory/skills.

The practical lesson is that personal agents need multiple small guardrails near the surface where risk appears.

## Code References

- `$HERMES/agent/tool_guardrails.py:1` - pure side-effect-free tool-loop guardrail primitives.
- `$HERMES/agent/tool_guardrails.py:20` - idempotent tool set.
- `$HERMES/agent/tool_guardrails.py:41` - mutating tool set.
- `$HERMES/agent/tool_guardrails.py:63` - guardrail config thresholds.
- `$HERMES/agent/tool_guardrails.py:127` - stable hashed tool-call signature.
- `$HERMES/agent/tool_guardrails.py:224` - per-turn controller.
- `$HERMES/tools/approval.py:1` - dangerous command approval system.
- `$HERMES/tools/approval.py:26` - YOLO mode frozen at import to prevent in-process bypass.
- `$HERMES/tools/approval.py:31` - contextvars for gateway session identity.
- `$HERMES/tools/approval.py:153` - sensitive write target patterns.
- `$HERMES/tools/approval.py:214` - hardline blocklist comments.
- `$HERMES/agent/file_safety.py:28` - exact denied write paths.
- `$HERMES/agent/file_safety.py:96` - write denylist and safe-root enforcement.
- `$HERMES/agent/file_safety.py:165` - read-deny error for secret/cache paths.
- `$HERMES/tools/write_approval.py:1` - memory/skill write approval gate and pending store.
- `$HERMES/tools/write_approval.py:38` - pending records live under `HERMES_HOME/pending`.
- `$HERMES/tools/threat_patterns.py:1` - shared prompt-injection/exfiltration scanner.
- `$HERMES/tools/threat_patterns.py:187` - scoped threat scanning.
- `$HERMES/agent/memory_manager.py:70` - streaming memory-context scrubber.
- `$HERMES/tools/registry.py:234` - tool name collision/override rules.
- `$HERMES/tools/mcp_tool.py:373` - MCP description prompt-injection warning patterns.

## Design and Rationale

The tool-loop guardrail is pure and per-turn. It observes repeated exact failures and no-progress idempotent calls, then returns decisions without performing side effects. Runtime code decides how to surface warnings or halt. That separation makes it testable and avoids hidden mutations inside policy logic.

The dangerous command approval layer is session-aware through contextvars, not process-global env alone. That matters for gateway concurrency. It also freezes YOLO mode at import time so a malicious skill cannot set an environment variable inside the process and bypass approvals.

The file safety module is explicit that read-deny is defense in depth, not a complete security boundary, because the terminal tool still runs as the same OS user (`$HERMES/agent/file_safety.py:188`). This honesty is architecturally valuable. Overstating a guardrail leads designers to put too much trust in it.

Write approval for memory/skills is separate from command approval because the threat is different: autonomous long-term self-modification. Background review cannot block on an interactive prompt, so writes can be staged for later review (`$HERMES/tools/write_approval.py:32`).

The remaining gap is a coherent permission model. Approval prompts are interactions, not a full authorization system. A new framework should define who can grant access, what exact action/parameter scope is granted, whether it is session/profile/project/global, how long it lasts, how it is revoked, and how the audit log is shown to the user.

OS isolation should be treated as a baseline for dangerous tools. Hermes clearly notes read-deny is defense in depth rather than a hard boundary (`$HERMES/agent/file_safety.py:188`). Same-user terminal, browser, and file tools can often bypass application-level denies. For stronger containment, use OS permissions, containers/VMs, filesystem allowlists, network egress policy, and separate credentials per sandbox.

Credentials and config are part of the safety boundary. Hermes stores broad settings in `config.yaml`, protects corrupted config by backup instead of silent mutation, and warns that parse failures can ignore provider/fallback/model settings (`$HERMES/hermes_cli/config.py:43`, `$HERMES/hermes_cli/config.py:97`). It also blocks some secret-bearing files through read/write guards (`$HERMES/agent/file_safety.py:165`). A new framework should define precedence among env vars, profile config, secret stores, OAuth tokens, and runtime overrides, then keep model-visible tools out of raw secret stores.

## Integration and Coupling

Safety couples to:

- Terminal and file tools.
- Gateway session identity and approval routing.
- Memory and skill write paths.
- MCP tool ingestion.
- Tool registry collision rules.
- Background review provenance.
- Prompt assembly and streaming output.

Exfiltration is often source-to-sink, not one dangerous command. A model may read private data through an allowed file/search/browser tool and send it through an allowed messaging/MCP/web/form tool. The permission system should reason about data classes and sinks: "can read secrets" and "can send external messages" should not silently compose.

## Permission Target

| Control | Minimum behavior |
| --- | --- |
| Grants | Narrow, parameter-scoped, expiring, revocable. |
| Risk classes | Read-only, local write, network fetch, network send, credential use, irreversible action. |
| Audit | Tool call, actor, grant, source data class, sink, result. |
| Isolation | OS/sandbox boundary for shell/browser/code execution. |
| Memory/skill writes | Staged or approved with provenance and rollback path. |

## External Discussion

Public LLM-agent security discussion has raised prompt injection, tool poisoning, cross-tool exfiltration, excessive agency, and sensitive-information disclosure risks. Hermes' design choices around MCP metadata scanning, safe env, secret stripping, file guards, and collision rules are consistent with those concerns, though this is an external comparison rather than evidence of Hermes authors' intent. See OWASP's LLM Top 10 at https://owasp.org/www-project-top-10-for-large-language-model-applications/, the MCP security/governance survey at https://arxiv.org/abs/2511.20920, and MCP tool-poisoning work at https://arxiv.org/abs/2603.22489.

## Lessons for a New Framework

- Place safety checks close to the risky action.
- Keep policy code pure when possible, and let runtime code surface decisions.
- Use context-local session identity for approvals in concurrent gateways.
- Freeze bypass modes so in-process tools cannot flip them mid-run.
- Treat read/file deny as defense in depth, not a sandbox.
- Gate autonomous memory/skill writes separately from shell commands.
