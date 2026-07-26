# Hermes Agent Reference Analysis

> Historical guidance: this research was retained from the previous workspace.
> References using `$HERMES` point to a source checkout that is not included in
> this repository, so verify them against the relevant Hermes revision before
> using them as implementation evidence.

This directory is a component-oriented architecture study of a former local
`hermes-agent/` checkout. Code references use `$HERMES` as an alias for that
repository root, for example `$HERMES/hermes_state.py:583`.

The analysis is intended for people designing a new personal assistant style agent framework. Each file focuses on what Hermes implements, why the design exists, where it is coupled to other subsystems, and what should or should not be copied into a new framework.

## Source Notes

- Primary evidence is the local Hermes codebase.
- External comparisons are explicitly marked as assumptions or comparisons. They are not claims about Hermes' authors' intent unless the local code states that intent.
- Hermes is a mature, heavily integrated system. The useful lesson is usually the domain boundary or invariant, not necessarily the exact file layout or amount of runtime coupling.
- Personal assistants handle transcripts, credentials, local files, browser state, communication channels, and long-term user memory. The analysis therefore treats privacy, user control, permission scope, reversibility, and observability as design constraints wherever state or side effects appear.

## Map

- `00_overview/architecture_map.md` - how the major subsystems fit together.
- `01_persistence/session_db_and_search.md` - SQLite transcript, FTS, schema repair, and search windows.
- `01_persistence/session_lineage_rewind_compression.md` - branch, undo, compression continuation, and logical conversation identity.
- `02_memory/builtin_curated_memory.md` - file-backed user/profile memory and prompt-injection handling.
- `02_memory/memory_provider_and_honcho.md` - external memory provider contract and Honcho integration.
- `03_interaction/gateway_and_tui_sessions.md` - gateway session identity, multi-platform prompts, TUI mutations.
- `04_tools/tool_registry_toolsets_and_search.md` - registry, toolsets, schema assembly, and progressive tool disclosure.
- `04_tools/mcp_integration.md` - MCP client/server design and threat boundaries.
- `05_reliability/retry_failover_and_error_recovery.md` - error taxonomy, backoff, fallback, and runtime recovery.
- `06_safety/guardrails_permissions_and_prompt_security.md` - command approvals, write gates, file safety, and loop guardrails.
- `07_providers/provider_adapters.md` - provider profiles, transports, and compatibility normalization.
- `08_learning/background_review_and_skills.md` - learning-from-past loop, skills, provenance, and write approvals.
- `09_evals/testing_and_evaluation_strategy.md` - test suite shape and eval harness lessons.
