# Memory Provider Interface and Honcho

## Overview

Hermes separates built-in file memory from optional external memory providers through a provider interface and a `MemoryManager`. The manager permits one external provider at a time, fences context before prompt injection, routes provider tools, runs background sync/prefetch, and invokes lifecycle hooks.

Honcho is the main external memory provider in the local code. It adds cross-session user modeling, dialectic Q&A, semantic search, peer cards, and prompt-ready context.

## Code References

- `$HERMES/agent/memory_provider.py:1` - provider lifecycle and hook contract.
- `$HERMES/agent/memory_provider.py:42` - abstract provider API starts.
- `$HERMES/agent/memory_provider.py:72` - providers should skip writes in non-primary contexts to avoid cron/subagent corruption.
- `$HERMES/agent/memory_provider.py:175` - session switch semantics.
- `$HERMES/agent/memory_provider.py:219` - pre-compression hook.
- `$HERMES/agent/memory_provider.py:231` - delegation hook.
- `$HERMES/agent/memory_manager.py:1` - single integration point for memory providers.
- `$HERMES/agent/memory_manager.py:51` - memory-context fencing/sanitization regexes.
- `$HERMES/agent/memory_manager.py:70` - streaming scrubber removes leaked memory-context tags from output.
- `$HERMES/agent/memory_manager.py:252` - one built-in provider plus at most one external provider.
- `$HERMES/agent/memory_manager.py:273` - `add_provider` enforces single external provider.
- `$HERMES/agent/memory_manager.py:299` - provider tools cannot shadow core tools.
- `$HERMES/agent/memory_manager.py:429` - async sync rationale and single-worker executor.
- `$HERMES/agent/memory_manager.py:554` - provider tool schema collection and dedupe.
- `$HERMES/agent/agent_init.py:1131` - external memory provider plugin load/config/init.
- `$HERMES/agent/agent_init.py:1196` - provider tool schema injection gated by enabled toolsets.
- `$HERMES/run_agent.py:2955` - end-of-turn external memory sync and prefetch queue.
- `$HERMES/plugins/memory/honcho/__init__.py:1` - Honcho provider overview.
- `$HERMES/plugins/memory/honcho/__init__.py:36` - Honcho profile tool schema.
- `$HERMES/plugins/memory/honcho/__init__.py:191` - provider init fields/cadence/lazy init.
- `$HERMES/plugins/memory/honcho/__init__.py:280` - cron guard in initialize.
- `$HERMES/plugins/memory/honcho/__init__.py:371` - fail-open background session initialization.
- `$HERMES/plugins/memory/honcho/__init__.py:578` - prompt-cache-friendly system prompt block.
- `$HERMES/plugins/memory/honcho/__init__.py:622` - prefetch context/dialectic logic.
- `$HERMES/plugins/memory/honcho/client.py:291` - Honcho config fields.
- `$HERMES/plugins/memory/honcho/session.py:71` - session manager runs alongside SQLite/file memory.
- `$HERMES/pyproject.toml:160` - optional `honcho-ai==2.0.1` dependency.

## Design and Rationale

The interface is lifecycle-oriented rather than just "retrieve memories". Providers can initialize, prefetch, sync a turn, expose tools, handle session switches, observe compression, and react to delegation. That matches the needs of a personal assistant where memory is stateful, identity-aware, and affected by UI actions like rewind.

The manager enforces one external provider. This is a conservative design. Multiple external memory providers can double-write sensitive history, disagree about user identity, compete for context budget, and expose overlapping tools. If a framework later supports multiple providers, it needs a memory arbitration layer, not just a list.

The context fencing and streaming scrubber matter because memory context is intended for the model, not the final user answer. The scrubber handles split stream deltas (`$HERMES/agent/memory_manager.py:70`), which is the sort of detail easy to miss in streaming agents.

Honcho integration is lazy and fail-open. The provider can start session init in the background, avoid cron ingestion, and serve stale/partial context under timeout pressure (`$HERMES/plugins/memory/honcho/__init__.py:371`, `$HERMES/plugins/memory/honcho/__init__.py:622`). That is the right bias for interactive assistants: memory enrichment should improve turns but not brick the core chat loop.

Fail-open has a user-trust cost. If memory is unavailable, stale, or skipped due to timeout, the assistant may behave inconsistently while appearing fully informed. A new framework should surface memory status in debug/status UI and let high-stakes turns require fresh memory or continue explicitly without it.

## Integration and Coupling

This component is tightly coupled to:

- Prompt assembly, through `system_prompt_block` and fenced memory context.
- Tool assembly, because provider tools are injected only when the `memory` toolset is enabled.
- Session state, through hooks for switch, rewind, compression, and delegation.
- Gateway/profile identity, because Honcho peer/session selection depends on profile, host, platform, and user aliases.
- Turn lifecycle, through post-turn sync and next-turn prefetch.

Identity is the highest-risk coupling. Personal assistants often start as single-user tools and then gain messaging gateways, group chats, delegated sessions, cron jobs, and profiles. A wrong merge between peers, channels, or profiles can leak facts from one person or context into another. External memory providers should require a formal identity model: subject, actor, channel, group, profile, and delegation context.

## Provider-Neutral Requirements

An external memory provider contract should define more than recall:

| Requirement | Why it matters |
| --- | --- |
| Identity separation | Prevent cross-user or cross-channel leakage. |
| Write consent | Long-term user modeling should be reviewable. |
| Deletion/export | Users must be able to leave or correct the system. |
| Staleness signal | Fail-open should not be invisible. |
| Conflict handling | New memories can contradict old ones. |
| Latency budget | Recall must not stall the assistant indefinitely. |
| Audit trail | Memory influence should be explainable after the fact. |

## External Comparison

Honcho's public README describes a loop of storing messages/events, background reasoning, querying peer/session context/search, then injecting the result into any model call. Hermes maps directly onto this loop with `sync_turn`, `prefetch`, and system prompt/context injection. See https://github.com/plastic-labs/honcho.

Assumption/comparison: Honcho's peer-centric model is richer than simple vector recall because it tracks users, agents, groups, projects, and cross-peer representations. Hermes appears to use that to supplement, not replace, its local transcript and file memory.

## Lessons for a New Framework

- Design external memory as a lifecycle provider, not only a retriever.
- Fence memory context and scrub streamed output.
- Fail open when external memory is slow or unavailable.
- Avoid allowing provider tools to shadow core tools.
- Start with one external memory provider unless you can arbitrate identity, writes, and context budget.
- Propagate session switch/rewind/compression events to memory caches.
