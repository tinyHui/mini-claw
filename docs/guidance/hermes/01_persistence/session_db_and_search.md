# Session Database and Search

## Overview

Hermes uses SQLite as the canonical local transcript store. The schema stores sessions, messages, metadata, token/cost counters, platform message IDs, reasoning fields, tool calls, and an `active` flag for soft deletion. Search is built into the same store using SQLite FTS5, including a trigram index for substring/CJK search.

This is a good personal-agent design because transcript history is not just audit data. It powers resume, retry, undo, compression, session search, context reconstruction, and gateway continuity.

## Code References

- `$HERMES/hermes_state.py:436` - schema version and schema bootstrap.
- `$HERMES/hermes_state.py:440` - `sessions` table with parent session, cost, title, handoff, rewind count, and archive fields.
- `$HERMES/hermes_state.py:477` - `messages` table with content, tool fields, reasoning fields, platform IDs, and `active`.
- `$HERMES/hermes_state.py:527` - FTS table over `content`, `tool_name`, and `tool_calls`.
- `$HERMES/hermes_state.py:552` - trigram FTS table for CJK/substring-style search.
- `$HERMES/hermes_state.py:583` - `SessionDB` class describes SQLite-backed storage with FTS5.
- `$HERMES/hermes_state.py:591` - WAL/contention policy comments.
- `$HERMES/hermes_state.py:637` - normal SQLite connection uses autocommit and WAL setup.
- `$HERMES/hermes_state.py:657` - malformed schema repair path.
- `$HERMES/hermes_state.py:698` - FTS support probe/rebuild path.
- `$HERMES/hermes_state.py:800` - `_execute_write` uses `BEGIN IMMEDIATE`, lock, rollback, jittered retry.
- `$HERMES/hermes_state.py:941` - declarative column reconciliation from `SCHEMA_SQL`.
- `$HERMES/hermes_state.py:985` - `_init_schema` executes schema and migrations.
- `$HERMES/hermes_state.py:1075` - v11 FTS reindex includes tool metadata.
- `$HERMES/hermes_state.py:2266` - `append_message` persists transcript rows.
- `$HERMES/hermes_state.py:2363` - `replace_messages` atomically rewrites transcript for retry/undo/compress flows.
- `$HERMES/hermes_state.py:2449` - `get_messages` excludes inactive rows by default.
- `$HERMES/hermes_state.py:3133` - `search_messages` query options and filtering.

## Design and Rationale

The storage design is deliberately boring and durable. SQLite is embedded, observable, transactional, and compatible with single-user personal-agent deployments. WAL mode plus short timeouts and application-level jitter make sense because Hermes has concurrent surfaces: TUI, gateway, cron, background review, subagents, and memory sync. The code comments explicitly discuss write contention and checkpoint policy (`$HERMES/hermes_state.py:591`).

Schema evolution is also treated as a runtime responsibility. Instead of assuming a perfect migration history, Hermes reconciles missing columns from the declared schema (`$HERMES/hermes_state.py:941`) and has repair paths for malformed schema state (`$HERMES/hermes_state.py:657`). For a personal assistant installed on laptops, VPSs, and long-lived user profiles, this is more realistic than relying only on clean migration runs.

Search is integrated with transcript storage rather than delegated entirely to vector memory. FTS over content plus tool names/tool calls means the agent and user can find past operational steps, not just semantic summaries. The anchored-window helpers around search results preserve local conversational context (`$HERMES/hermes_state.py:2500`, `$HERMES/hermes_state.py:2562`).

## Privacy and User Trust

Transcript durability is a privacy decision, not only a reliability decision. Hermes stores raw content, platform message IDs, reasoning fields, tool calls, token counts, and inactive rows (`$HERMES/hermes_state.py:477`). That is valuable for resume, search, audit, and repair, but it increases blast radius if the database leaks or if users expect undo to mean deletion.

For a new framework, define these policies before copying the schema:

- Retention: default lifetime, per-session expiry, and archival rules.
- Deletion: hard delete, soft delete, export, and "undo" semantics must be user-visible.
- Encryption: local-at-rest encryption or OS keychain integration if transcripts contain credentials or third-party platform messages.
- Redaction: whether secrets/tool outputs are stored raw, summarized, or omitted.
- Search scope: whether inactive, archived, private, or cross-channel sessions can be searched by the model.

## Integration and Coupling

The database couples to:

- TUI and gateway session lists/resume.
- `/retry`, `/undo`, and `/compress` through atomic message replacement and inactive rows.
- Session search tools and LLM summarization over search windows.
- Memory providers through session IDs and lifecycle hooks.
- Compression locks and continuation sessions.

This coupling is acceptable because transcript state is the source of truth. Trying to hide it behind a generic repository interface would likely obscure important semantics such as `active=0`, continuation chains, and FTS repair.

## Failure Modes

| Failure | User impact | Hermes mitigation | New-framework target |
| --- | --- | --- | --- |
| SQLite/FTS corruption | Lost resume/search, startup failure | Schema repair, FTS rebuild, malformed schema handling | Add backup/restore UX and integrity checks. |
| Soft-deleted content remains | User believes content was removed when it is only inactive | `active=0` default filtering | Label undo vs delete; provide hard-delete path. |
| Bad search recall | Agent cites stale or unrelated past context | FTS, trigram CJK fallback, anchored windows | Add ranking evals, recency/source filters, and poisoning controls. |
| Tool-call metadata search leaks old operations | Sensitive operations become discoverable | Local DB by default | Permission search by session/source and export redaction. |

## External Comparison

Assumption/comparison: LangGraph documents persistence as two systems: checkpointers for thread-scoped state and stores for long-term cross-thread data. Hermes implements the thread/checkpoint side with a relational transcript DB and then layers file/Honcho memory for long-term data. See https://docs.langchain.com/oss/python/langgraph/persistence.

Assumption/comparison: Letta's docs emphasize that messages remain stored even after compaction/eviction. Hermes follows the same principle by persisting all transcript rows and marking rewound rows inactive rather than deleting them. See https://docs.letta.com/guides/core-concepts/stateful-agents.

## Lessons for a New Framework

- Store raw transcript, tool calls, and reasoning metadata before building advanced memory.
- Use soft deletion for undo/rewind so audit and recovery remain possible.
- Put search close to the transcript store so operational history is searchable.
- Design for broken migrations and partially upgraded user profiles.
- Make write contention a first-class design problem if gateways/background jobs can run concurrently.
