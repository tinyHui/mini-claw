# Gateway and TUI Sessions

## Overview

Hermes supports CLI/TUI and messaging gateways from the same agent runtime. The gateway layer tracks platform identity, redaction policy, session source metadata, and prompt context. The TUI gateway adds RPC commands for undo, compression, branch, interrupt, approvals, and live history mutation.

The important design lesson is that interaction is part of state management. A chat turn from Discord, Telegram, Slack, WhatsApp, Signal, CLI, or TUI is not just text; it has routing identity, platform message IDs, approval channels, display capabilities, and privacy implications.

## Code References

- `$HERMES/gateway/session.py:1` - gateway session utilities.
- `$HERMES/gateway/session.py:70` - `SessionSource` carries source routing and platform fields.
- `$HERMES/gateway/session.py:160` - `SessionContext` fields for prompt context.
- `$HERMES/gateway/session.py:196` - PII-safe platform redaction policy.
- `$HERMES/gateway/session.py:232` - `build_session_context_prompt` redaction notes.
- `$HERMES/hermes_state.py:477` - messages table stores `platform_message_id`, `observed`, and related fields.
- `$HERMES/tui_gateway/server.py:2048` - compression can rotate agent session ID and requires gateway re-anchor.
- `$HERMES/tui_gateway/server.py:4486` - undo RPC rejects mutation while running.
- `$HERMES/tui_gateway/server.py:4514` - compression RPC computes before/after history and emits session info.
- `$HERMES/tui_gateway/server.py:4677` - branch RPC creates a DB child and live agent.
- `$HERMES/tui_gateway/server.py:7768` - slash `/undo` reloads active transcript and notifies memory providers.
- `$HERMES/README.md:22` - Hermes advertises TUI and multi-platform gateway operation.

## Design and Rationale

The gateway models source explicitly. This lets the agent know whether a message came from a platform, channel, thread, or user identity and lets prompt construction redact details for platforms that are not considered PII-safe. For personal assistants, this is necessary because the same logical user can interact across multiple surfaces.

The TUI RPCs expose state operations rather than only display commands. Undo, branch, and compression are session mutations with database consequences. Hermes therefore guards these operations with `running` checks and history locks.

Approval routing is also session-bound. After compression rotates `agent.session_id`, the gateway must move YOLO/approval notify state from old session key to the new continuation. This is a subtle but important lesson: if the model runtime can rotate identity, every control-plane feature keyed by identity must be re-anchored.

Interaction surfaces are also authorization surfaces. Routing metadata is not sufficient by itself: a personal assistant reachable from messaging platforms needs pairing, revocation, per-channel grants, role/user allowlists, replay protection, duplicate-event handling, attachment policy, and clear behavior for edited/deleted messages. Hermes has platform-specific guidance and gateway session context, and config includes role/DM authorization settings for Discord (`$HERMES/hermes_cli/config.py:1912`), but a new framework should make these rules a first-class interaction policy.

## Integration and Coupling

The interaction layer couples to:

- `SessionDB` for title/history/session list and branch/rewind rows.
- Approval module for gateway notification registration and YOLO state.
- Memory manager for session switch and rewind hooks.
- Prompt builder through session context prompt.
- Agent runtime through live history, interrupt flags, and session ID.

The TUI gateway is a cautionary example of control-plane concentration. It is not presentation only: it mutates sessions, branches, compression, approvals, slash workers, attachments, and live agent state. A new framework should split UI transport, command parsing, session mutation service, approval service, and event publication so invariants can be tested without a full TUI server.

## Failure Modes

| Failure | Impact | New-framework target |
| --- | --- | --- |
| Duplicate webhook delivery | Same instruction executes twice | Idempotency keys per platform message. |
| Out-of-order messages | Agent answers stale or wrong turn | Per-channel ordering and turn queue. |
| Channel membership changes | Unauthorized user can steer assistant | Recheck membership/roles on each privileged action. |
| Session ID rotation misses approval state | Approvals route to dead session | Central session identity service. |
| Group chat identity merge | One user's facts leak to another | Actor vs room vs profile separation. |

## Lessons for a New Framework

- Make platform/source identity a typed object, not loose environment variables only.
- Design session mutation RPCs with concurrency guards.
- Keep in-memory history and persisted history synchronized after every mutation.
- Re-key approval/routing state when compression or continuation changes session ID.
- Redact platform metadata based on an explicit policy.
