# Retry, Failover, and Error Recovery

## Overview

Hermes has a centralized error classifier, jittered backoff, per-turn retry state, provider fallback, credential-pool recovery, message-sequence repair, context overflow handling, image shrink recovery, and provider-specific error normalization. The retry system is not "retry N times"; it is a taxonomy-driven recovery graph.

## Code References

- `$HERMES/agent/error_classifier.py:1` - centralized classification module.
- `$HERMES/agent/error_classifier.py:24` - `FailoverReason` enum.
- `$HERMES/agent/error_classifier.py:69` - `ClassifiedError` actions/fields.
- `$HERMES/agent/error_classifier.py:95` - billing/rate/usage patterns.
- `$HERMES/agent/error_classifier.py:156` - payload/image-too-large patterns.
- `$HERMES/agent/error_classifier.py:207` - context overflow patterns.
- `$HERMES/agent/error_classifier.py:441` - `classify_api_error` priority pipeline.
- `$HERMES/agent/retry_utils.py:19` - jittered exponential backoff.
- `$HERMES/agent/turn_retry_state.py:1` - turn retry flags refactored into a dataclass.
- `$HERMES/agent/conversation_loop.py:799` - `TurnRetryState` created for the API call loop.
- `$HERMES/agent/conversation_loop.py:1993` - API error classification.
- `$HERMES/agent/conversation_loop.py:2055` - oversized image shrink recovery.
- `$HERMES/agent/conversation_loop.py:2079` - multimodal tool-content downgrade.
- `$HERMES/agent/conversation_loop.py:2440` - auto-compaction disabled guard.
- `$HERMES/agent/conversation_loop.py:2489` - Anthropic long-context tier reduction and compression.
- `$HERMES/agent/conversation_loop.py:2547` - eager fallback for rate limit/billing.
- `$HERMES/agent/conversation_loop.py:2920` - non-retryable client errors try fallback before aborting.
- `$HERMES/agent/conversation_loop.py:3215` - `Retry-After` and jittered interruptible sleep.
- `$HERMES/agent/chat_completion_helpers.py:1045` - fallback activation mutates runtime/provider/client state.
- `$HERMES/agent/agent_runtime_helpers.py:347` - message sequence repair.
- `$HERMES/agent/agent_runtime_helpers.py:449` - strips think/tool-call XML from messages.
- `$HERMES/agent/agent_runtime_helpers.py:545` - credential-pool recovery.
- `$HERMES/agent/credential_pool.py:1` - persistent multi-credential pool.
- `$HERMES/agent/gemini_native_adapter.py:145` - Gemini error shape compatible with classifier.
- `$HERMES/agent/gemini_native_adapter.py:719` - Gemini HTTP error normalization with retry-after extraction.

## Design and Rationale

Central classification prevents ad hoc string matching from spreading across the loop. Once an error is classified, the loop can decide whether to shrink payloads, downgrade multimodal tool messages, refresh credentials, compact context, activate fallback, sleep according to `Retry-After`, or surface a user-facing abort.

Fallback activation is deliberately runtime-mutating. `try_activate_fallback` swaps provider/model/api mode/client state and recomputes prompt-cache/compressor context (`$HERMES/agent/chat_completion_helpers.py:1045`). That is complex, but it avoids reconstructing an agent mid-turn and losing accumulated state.

Message repair is another practical recovery layer. Real provider APIs can reject malformed alternation or tool-message sequences; Hermes repairs sequence invariants before calls instead of treating every malformed local history as fatal.

Reliability must distinguish retryable transport failures from unknown side-effect outcomes. Retrying a model call is usually safe if no tool call was committed; retrying a tool call can duplicate messages, writes, purchases, API mutations, or browser actions. A new framework should track idempotency keys and "unknown outcome" states per tool call and external action.

## Integration and Coupling

Retry is coupled to:

- Provider profiles and transports, because fallback changes API mode and request formatting.
- Credential pool, because billing/rate/auth failures can rotate keys.
- Context compression, because context overflow may require transcript mutation.
- Vision/media tooling, because image payload errors can shrink embedded media.
- Interrupt handling, because sleeps and background API calls must remain cancellable.
- Prompt cache metadata, because fallback/provider changes alter cache semantics.

Provider fallback is not only availability. It can change model behavior, tool-call format, safety policy, privacy posture, data region, retention policy, latency, and cost. Hermes mutates runtime state to continue the turn; a new framework should additionally require fallback policy: which providers may receive which data classes, when the user must be notified, and whether high-sensitivity sessions can fallback at all.

Observability is part of the retry design. Hermes stores token and cost counters in sessions (`$HERMES/hermes_state.py:453`, `$HERMES/hermes_state.py:1414`) and emits retry/fallback traces to users (`$HERMES/run_agent.py:882`). A new framework should also expose structured retry events, model/provider switch events, per-recovery cost, latency, and final degradation reason.

Long-running orchestration increases the need for this structure. Hermes bridges active turns to kanban worker heartbeats so a dispatcher does not reclaim live work (`$HERMES/run_agent.py:2695`), and its config includes per-profile worker concurrency controls (`$HERMES/hermes_cli/config.py:2123`). A new framework should treat background work, cron jobs, and delegated workers as reliability domains with leases, heartbeats, idempotent task claims, and visible failure states.

## Failure Modes

| Failure | Impact | New-framework target |
| --- | --- | --- |
| Retry after hidden side effect | Duplicate send/write/action | Idempotency and unknown-outcome state. |
| Fallback provider differs semantically | Different answer/tool behavior | User-visible fallback and capability revalidation. |
| Auto-compression recovery loses facts | Future turns drift | Compression fidelity eval and source ranges. |
| Repeated recovery increases spend | User sees success but pays more | Cost budget, retry caps, structured reporting. |

## Lessons for a New Framework

- Build an error taxonomy early.
- Keep retry state per turn so one recovery path does not loop forever.
- Honor provider `Retry-After` when present.
- Distinguish rate limit, billing, auth, policy, context, payload, transport, and server errors.
- Normalize provider-specific exceptions into a common classifier shape.
- Make fallback switch all related runtime state atomically enough for the next call.
