# Built-In Curated Memory

## Overview

Hermes has a built-in memory tool backed by profile-scoped files: `MEMORY.md` for operational/project memory and `USER.md` for user profile facts. The important design is that the agent writes short declarative entries, but prompt assembly uses a frozen sanitized snapshot rather than rereading live mutable state on every access.

This file-backed memory is simple, inspectable, and works without an external service. It also provides a base layer even when an external memory provider is configured.

## Code References

- `$HERMES/tools/memory_tool.py:3` - module doc describes `MEMORY.md`, `USER.md`, frozen snapshots, and prompt-cache stability.
- `$HERMES/tools/memory_tool.py:51` - profile-scoped memory directory.
- `$HERMES/tools/memory_tool.py:62` - strict threat scanning comments.
- `$HERMES/tools/memory_tool.py:83` - drift guard error type.
- `$HERMES/tools/memory_tool.py:113` - `MemoryStore` snapshot/live-state contract.
- `$HERMES/tools/memory_tool.py:132` - `load_from_disk` scans and deduplicates entries.
- `$HERMES/tools/memory_tool.py:172` - snapshot sanitization replaces suspicious entries.
- `$HERMES/tools/memory_tool.py:208` - file lock handling.
- `$HERMES/tools/memory_tool.py:252` - reload/drift guard around live file state.
- `$HERMES/agent/agent_init.py:1106` - built-in memory store initialization.
- `$HERMES/tools/threat_patterns.py:1` - shared prompt-injection/exfiltration pattern library.
- `$HERMES/tools/write_approval.py:1` - optional approval gate for memory/skill writes.

## Design and Rationale

The key idea is stable, curated memory rather than raw episodic replay. A small file is easy for users to inspect and edit. Short entries reduce context pressure and reduce the damage of accidental bad memory.

The frozen snapshot pattern is important for prompt-cache economics and safety. If the runtime used a live mutable memory file for every prompt assembly, background writes could perturb the system prompt, break provider prefix cache reuse, or inject unreviewed content mid-turn. Hermes instead distinguishes the live state used for writes from the sanitized snapshot used for prompt context (`$HERMES/tools/memory_tool.py:113`).

The threat scanner is aggressive for persistent memory because false positives can be resolved by the user, while poisoned memory can persist across sessions. The shared pattern library explicitly separates `all`, `context`, and `strict` scopes so blocking can be stronger on user-mediated persistent writes than on arbitrary tool output (`$HERMES/tools/threat_patterns.py:10`, `$HERMES/tools/threat_patterns.py:187`).

Regex scanning is useful as a tripwire, not a security boundary. Prompt injection is contextual and can be encoded as benign-looking instructions, images, retrieved documents, or social-engineering text. For persistent memory, a new framework should combine scanning with trust labels, write review, source provenance, least-privilege retrieval, and a UI for editing or expiring entries.

The flat file model is easy to inspect but too coarse as a complete memory model. `MEMORY.md` and `USER.md` mix concepts that age differently: durable user preferences, project-local facts, temporary task state, episodic events, tool setup notes, and procedural lessons. Hermes' prompt guidance warns not to store transient project state as memory (`$HERMES/agent/prompt_builder.py:144`), which is a useful rule; a new framework should enforce it structurally.

## Integration and Coupling

Built-in memory couples to:

- Agent initialization and system prompt construction.
- Background review, which can write memory after a turn.
- Write approval staging, especially for background-origin writes.
- External memory sync metadata, because the same memory action can be mirrored or observed by providers.
- Prompt-injection scanning and file drift detection.

The coupling is heavy but justified because persistent memory is both a capability and a long-term risk surface.

## Memory Governance Target

Each durable memory entry should ideally carry:

| Field | Purpose |
| --- | --- |
| Source | Conversation/session/tool/user action that created it. |
| Type | User preference, user fact, project fact, procedure, temporary state, or episode. |
| Scope | Global user, profile, project, channel, group, or task. |
| Confidence | Whether it was explicit, inferred, or contradicted. |
| Timestamp and expiry | Aging and removal policy. |
| Consent/review state | Whether the user approved it or it was staged. |

Hermes' file store is a strong bootstrap layer because it is inspectable. It should not be mistaken for a full governance model by itself.

## External Comparison

Assumption/comparison: Letta describes editable memory blocks attached to an agent and injected into the context window. Hermes' file memory is a lighter-weight equivalent: user-editable blocks in files, injected into prompt state after sanitization. See https://docs.letta.com/guides/core-concepts/stateful-agents.

## Lessons for a New Framework

- Start with a user-inspectable memory layer before adding vector/user-model services.
- Keep persistent memory short, declarative, and reviewable.
- Separate live write state from prompt-injected snapshots.
- Use stricter prompt-injection scanning for persistent memory than for one-off tool results.
- Provide write approval for autonomous background memory updates.
