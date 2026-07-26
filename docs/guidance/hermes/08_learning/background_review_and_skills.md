# Background Review and Skills

## Overview

Hermes has a "learn from past" loop: after a turn, it can spawn a background review agent that replays a conversation snapshot and decides whether to update memory or skills. Skills are class-level instructions with optional references/templates/scripts and progressive disclosure through `skills_list` and `skill_view`.

This is one of Hermes' most distinctive personal-agent design choices: the framework can improve its own harness after work is completed.

## Code References

- `$HERMES/README.md:25` - closed learning loop feature summary.
- `$HERMES/agent/background_review.py:1` - background review module doc.
- `$HERMES/agent/background_review.py:34` - memory review prompt.
- `$HERMES/agent/background_review.py:45` - skill review prompt.
- `$HERMES/agent/background_review.py:150` - combined memory/skill prompt.
- `$HERMES/agent/background_review.py:237` - action summary extraction.
- `$HERMES/agent/background_review.py:300` - memory write metadata/provenance.
- `$HERMES/agent/background_review.py:327` - review worker in daemon thread.
- `$HERMES/agent/background_review.py:342` - non-interactive dangerous-command auto-deny.
- `$HERMES/agent/background_review.py:372` - review fork inherits parent runtime.
- `$HERMES/agent/background_review.py:384` - `skip_memory=True` avoids external provider side effects.
- `$HERMES/agent/background_review.py:399` - toolset parity for prompt-cache hits.
- `$HERMES/agent/background_review.py:417` - review write origin set to `background_review`.
- `$HERMES/agent/background_review.py:432` - inherit cached system prompt for prefix-cache reuse.
- `$HERMES/agent/background_review.py:452` - compression disabled in review fork.
- `$HERMES/agent/background_review.py:470` - runtime whitelist limited to memory/skills.
- `$HERMES/agent/background_review.py:573` - thread target and prompt selection.
- `$HERMES/run_agent.py:1419` - `AIAgent._spawn_background_review` wrapper.
- `$HERMES/tools/skills_tool.py:3` - skills tool overview and progressive disclosure.
- `$HERMES/tools/skills_tool.py:87` - skills live under `HERMES_HOME/skills`.
- `$HERMES/tools/skills_tool.py:111` - skill lookup path traversal guard.
- `$HERMES/tools/skills_tool.py:680` - `skills_list` metadata-only listing.
- `$HERMES/tools/skills_tool.py:855` - `skill_view`.
- `$HERMES/tools/skill_provenance.py:1` - provenance for background-created skill writes.
- `$HERMES/tools/skill_manager_tool.py:826` - approved skill writes bypass re-gating.
- `$HERMES/tools/skill_manager_tool.py:968` - background review-created skills are marked agent-created.
- `$HERMES/tools/write_approval.py:1` - memory/skill write approval gate.

## Design and Rationale

The background review fork inherits the parent runtime so it uses the same provider, model, base URL, credentials, and prompt cache (`$HERMES/agent/background_review.py:372`). This avoids spurious auth failures and reduces cost. It also sets `skip_memory=True` so external memory providers do not ingest the harness prompt and review output as if they were user conversation (`$HERMES/agent/background_review.py:384`).

The fork is deliberately constrained:

- Dangerous commands auto-deny.
- Runtime tool whitelist is memory/skills only.
- Compression is disabled.
- Status output is suppressed except a compact final summary.
- Write origin is marked `background_review` for provenance and approval.

The skill review prompt encodes a design philosophy: skills should be class-level and reusable, not one-session artifacts. It also warns against capturing transient setup failures as durable rules (`$HERMES/agent/background_review.py:124`). This is important because self-improvement can easily ossify mistakes.

The background reviewer is still an LLM, not an oracle. It can hallucinate durable lessons, encode a user's temporary misconception, preserve a transient environment failure, or create contradictory instructions. Hermes constrains tools and provenance, but a new framework should treat reviewer output as a proposal unless the user has opted into automatic writes for that scope.

## Integration and Coupling

Background review couples to:

- The main agent runtime for provider credentials and prompt cache.
- Tool registry/toolsets for memory and skills only.
- Skill provenance and curator metadata.
- Write approval staging for autonomous updates.
- Memory store but not external memory providers.
- User-visible callbacks in CLI/gateway.

Skills are long-term control surfaces. They need lifecycle management: ownership, versioning, conflict detection, deprecation, eval-before-use, rollback, and pruning. Hermes tracks skill usage/provenance and marks background-created skills (`$HERMES/tools/skill_usage.py:622`, `$HERMES/tools/skill_manager_tool.py:968`), which is the right direction; the design target is to make every self-improvement reversible and testable.

## Failure Modes

| Failure | Impact | New-framework target |
| --- | --- | --- |
| Reviewer stores wrong lesson | Future sessions start biased | Evidence-linked proposals and approval. |
| Skill conflicts with another skill | Inconsistent agent behavior | Conflict detection and skill precedence. |
| One-off task becomes durable rule | Overfitting to a transient case | Expiry, scope, and class-level review. |
| Generated skill is unsafe | Tool misuse becomes instruction | Safety scan plus eval before activation. |
| Memory/skill survives rewind | User cannot undo bad learning | Side-effect ledger and rollback UI. |

## External Comparison

Assumption/comparison: This resembles the emerging idea of optimizing an agent harness from past trajectories. A recent paper, "Retrospective Harness Optimization", describes using past trajectories to improve an agent harness without external labels. Hermes' implementation is simpler and online: it performs per-turn reflection into memory/skills rather than batched rollout optimization. See https://arxiv.org/abs/2606.05922.

## Lessons for a New Framework

- Let the agent learn from completed turns, but isolate the review runtime.
- Whitelist only memory/skill tools in the learning loop.
- Track provenance so autonomous artifacts can be reviewed, curated, or pruned.
- Gate background writes because the user is not present.
- Prefer class-level reusable skills over session-specific notes.
- Explicitly teach the reviewer not to persist transient failures as durable constraints.
