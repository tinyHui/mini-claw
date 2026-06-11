# Testing and Evaluation Strategy

## Overview

Hermes has a broad test suite covering storage, tools, provider quirks, gateway behavior, memory providers, MCP, security guards, Windows/platform support, packaging, and stress tests. It also includes a live tool-search harness and research-oriented trajectory scripts.

For a personal-agent framework, this is the right testing shape: many bugs are integration and regression bugs, not pure algorithm bugs.

## Code References

- `$HERMES/pyproject.toml:324` - pytest config.
- `$HERMES/pyproject.toml:330` - per-test timeout policy.
- `$HERMES/tests/stress/README.md:1` - stress/battle-test suite overview.
- `$HERMES/tests/stress/README.md:20` - concurrency, reclaim, subprocess, fuzz, and benchmark coverage.
- `$HERMES/scripts/LIVETEST_README.md:1` - tool-search live test harness.
- `$HERMES/scripts/LIVETEST_README.md:17` - live harness scenarios and assertions.
- `$HERMES/tests/tools/test_tool_search.py` - progressive disclosure unit coverage.
- `$HERMES/tests/tools/test_mcp_dynamic_discovery.py` - MCP dynamic discovery coverage.
- `$HERMES/tests/tools/test_mcp_oauth_manager.py` - MCP OAuth behavior.
- `$HERMES/tests/tools/test_command_guards.py` - command approval/guard coverage.
- `$HERMES/tests/tools/test_threat_patterns.py` - prompt-injection pattern coverage.
- `$HERMES/tests/tools/test_memory_tool.py` - built-in memory tool coverage.
- `$HERMES/tests/honcho_plugin/test_session.py` - Honcho session behavior.
- `$HERMES/tests/test_tui_gateway_server.py` - TUI gateway server regressions.
- `$HERMES/tests/test_ctx_halving_fix.py` - context overflow/output cap recovery behavior.
- `$HERMES/scripts/benchmark_browser_eval.py` - browser evaluation benchmarking script.
- `$HERMES/scripts/sample_and_compress.py` - trajectory sampling/compression utility.

## Design and Rationale

Hermes' tests reflect the fact that agent frameworks fail at boundaries:

- SQLite concurrency and migration.
- Tool dispatch and schema assembly.
- MCP dynamic discovery and OAuth.
- Prompt-injection and file/command safety.
- Provider-specific context/output limit behavior.
- Gateway session mutation.
- Cross-platform terminal/file behavior.
- Packaging data files and optional dependencies.

The stress suite is especially relevant. It tests concurrency, reclaim races, subprocess E2E, property fuzzing, and benchmark output under adversarial scheduling (`$HERMES/tests/stress/README.md:20`). That is the right approach for agent runtimes that run background workers, gateways, cron jobs, and tool subprocesses.

The live tool-search harness is also instructive. Progressive disclosure changes the model's behavioral surface, so Hermes records end-to-end transcripts against a real model and compares enabled/disabled modes (`$HERMES/scripts/LIVETEST_README.md:1`). Unit tests alone cannot validate whether a model will successfully search, describe, and call deferred tools.

The next step for a new framework is a risk-to-test map. A large test suite can still miss the invariants users care about: permission isolation, memory correctness, compression fidelity, provider fallback policy, transcript deletion semantics, tool idempotency, and gateway event ordering.

## Integration and Coupling

Testing couples to:

- Optional dependency policy, because extras and packaging must be verified.
- Provider fallback/retry, because real provider errors need stable classification.
- Security layers, because guardrail regressions can become data-loss or credential risks.
- UI/gateway state, because session mutation races are hard to see in isolated unit tests.

## Risk-to-Test Map

| Risk | Required tests/evals |
| --- | --- |
| Prompt injection through tools/MCP/web | Adversarial tool-output and metadata evals. |
| Memory stores false/stale facts | Memory precision/recall, contradiction, expiry, and rollback evals. |
| Compression loses constraints | Source-range fidelity checks and task-continuation evals. |
| Provider fallback changes behavior | Cross-provider contract and privacy-policy tests. |
| Tool retry duplicates side effects | Idempotency and unknown-outcome simulations. |
| Gateway events race | Duplicate/out-of-order webhook tests. |
| Permission prompts fatigue users | Grant-scope and audit UX tests. |
| Live model nondeterminism | Stored trajectories with behavior assertions and budget limits. |

For live evals, assert behavior rather than exact text: correct tool chosen, forbidden sink avoided, memory used only when scoped, fallback disclosed, cost within budget, and final answer preserves user constraints.

Browser/media and orchestration need their own evals. Browser evals should check local-vs-cloud routing, private URL handling, screenshot trust, credential leakage, and form submission approvals. Worker/cron evals should check duplicate claims, lease expiry, stale heartbeat recovery, per-profile concurrency, and idempotent replays.

## External Comparison

Assumption/comparison: Letta exposes an evals concept in its docs, and the broader agent ecosystem is moving toward harness-level evaluation rather than only model output checks. Hermes' local live harness and stress tests are consistent with that direction, but are repository-specific rather than a general hosted eval framework.

## Lessons for a New Framework

- Test the control plane, not only agent answers.
- Add stress tests for stateful concurrency and subprocess behavior.
- Keep security pattern tests near the pattern library.
- Use live model harnesses for model-behavior-dependent tool disclosure.
- Treat packaging and optional dependency tests as part of reliability.
- Capture baseline transcripts for nondeterministic live tests.
