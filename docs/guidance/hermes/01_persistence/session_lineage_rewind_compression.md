# Session Lineage, Rewind, and Compression

## Overview

Hermes models a conversation as more than one append-only row sequence. Sessions can branch, compress into continuation sessions, be rewound with inactive rows, and be projected forward to the latest compression tip for display. The database tracks parent-child relationships, while the TUI/gateway keeps live in-memory history synchronized with those changes.

This is one of the strongest examples in Hermes of state management designed around real assistant workflows, not just logging.

## Code References

- `$HERMES/hermes_state.py:440` - sessions carry `parent_session_id`, `end_reason`, `rewind_count`, and other lineage metadata.
- `$HERMES/hermes_state.py:1210` - `end_session` preserves the first end reason.
- `$HERMES/hermes_state.py:1554` - orphaned compression continuation cleanup.
- `$HERMES/hermes_state.py:1839` - `get_compression_tip` walks compression-continuation chains.
- `$HERMES/hermes_state.py:1875` - `list_sessions_rich` projects root sessions to live compression tips.
- `$HERMES/hermes_state.py:2363` - `replace_messages` supports `/retry`, `/undo`, and `/compress`.
- `$HERMES/hermes_state.py:2875` - `rewind_to_message` soft-deletes rows and increments rewind count.
- `$HERMES/tui_gateway/server.py:2048` - `_sync_session_key_after_compress` re-anchors gateway state after compression rotates session ID.
- `$HERMES/tui_gateway/server.py:4486` - `session.undo` RPC rejects mutation while a turn is running.
- `$HERMES/tui_gateway/server.py:4514` - `session.compress` RPC computes before/after history and syncs session key.
- `$HERMES/tui_gateway/server.py:4677` - `session.branch` creates a child session and copies active history.
- `$HERMES/tui_gateway/server.py:7768` - slash `/undo` backs up user turns through `rewind_to_message`.

## Design and Rationale

Compression is treated as a session transition, not only a prompt transformation. `get_compression_tip` distinguishes continuation children from branches and delegate subagents by checking parent end reason and timing (`$HERMES/hermes_state.py:1839`). `list_sessions_rich` then projects old roots to their live tips so a compressed conversation does not disappear or look stale (`$HERMES/hermes_state.py:1875`).

Undo is implemented as soft deletion (`active=0`) rather than row removal. The target user message is also inactivated so it can be prefilled and resubmitted without appearing twice (`$HERMES/hermes_state.py:2875`). This preserves auditability and keeps recovery possible.

The TUI rejects undo/compress while a turn is running (`$HERMES/tui_gateway/server.py:4486`, `$HERMES/tui_gateway/server.py:4514`). This is the right tradeoff: if live agent output and UI mutation race, either the undo is lost or the output is lost. Hermes chooses an explicit busy error.

Compression needs stronger guarantees than "the context got shorter." A new framework should track summary provenance, source message range, model/provider used for compression, compression prompt version, token budget, and whether the user can inspect or revert the compressed state. Hermes keeps the raw transcript in lineage, but the active context can still be steered by a bad summary.

## Integration and Coupling

Compression rotation affects approval routing, slash workers, session title state, and gateway session keys. `_sync_session_key_after_compress` documents that the agent's `session_id` changes while the gateway's `session_key` drives approvals, title/history lookup, and YOLO state (`$HERMES/tui_gateway/server.py:2048`).

Undo also couples to memory providers. After a rewind, the TUI reloads active history, notifies memory manager `on_session_switch(..., rewound=True)`, invalidates the system prompt, and resets DB flush indices (`$HERMES/tui_gateway/server.py:7812`). This prevents memory/provider caches from continuing to believe the old head is active.

Branching couples database lineage with live agent initialization. The branch RPC creates a new DB session with `_branched_from`, copies current active history, sets title, then creates a new agent for the branch (`$HERMES/tui_gateway/server.py:4677`).

Rewind is also not a global rollback. It inactivates transcript rows and notifies memory providers, but side effects may already have escaped: file memory entries, external memory writes, skills, sent messages, browser actions, terminal writes, or third-party API changes. A new framework should model rewind as "conversation-head rollback" and separately expose side-effect rollback where possible.

## Session Graph Target

A new framework should make lineage explicit:

| Node/edge | Meaning | Visibility rule |
| --- | --- | --- |
| Root session | User-visible conversation start | Listed by default. |
| Compression continuation | Same logical conversation after context compaction | Project to latest tip. |
| Branch | User-chosen alternate future | Listed and labeled with parent. |
| Delegate/subagent | Worker spawned for a task | Hidden from normal resume unless requested. |
| Rewind event | Active head moved backward | Auditable; not equivalent to deletion. |

Hermes infers parts of this from `parent_session_id`, end reason, timing, and model config markers. A new design should encode edge type directly.

## Failure Modes

| Failure | Impact | New-framework target |
| --- | --- | --- |
| Compression summary drops a constraint | Future turns act on a false state | Compression evals, inspectable summaries, source ranges. |
| Rewind after memory write | Wrong belief persists in memory | Memory side-effect ledger and rollback/review queue. |
| Branch inherits unsafe context | Alternate future starts polluted | Branch-time memory/tool-state snapshot policy. |
| Session tip projection hides data | User cannot find a raw child/root | Debug/admin view of raw graph. |

## Lessons for a New Framework

- Treat compression as a lineage operation with user-visible continuity.
- Keep branches, compression continuations, and subagents distinguishable in schema.
- Implement undo as soft deletion, not destructive truncation.
- Reject state mutation during active generation unless you have a real concurrency protocol.
- Notify memory/prompt caches after rewind or branch.
- Make session lists show logical conversations, not raw rows.
