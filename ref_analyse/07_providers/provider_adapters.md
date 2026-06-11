# Provider Adapters and Transports

## Overview

Hermes separates provider behavior into two concepts:

- `ProviderProfile`: declarative provider metadata, auth/endpoints, quirks, aliases, model catalog fallback, and small request hooks.
- `ProviderTransport`: format conversion and response normalization for an API mode.

The agent runtime owns client construction, streaming, credential rotation, retry logic, prompt caching, and fallback.

## Code References

- `$HERMES/providers/base.py:1` - provider profile design doc.
- `$HERMES/providers/base.py:38` - `ProviderProfile` dataclass.
- `$HERMES/providers/base.py:52` - auth and endpoint fields.
- `$HERMES/providers/base.py:59` - vision/tool-message capability fields.
- `$HERMES/providers/base.py:84` - client/request quirks.
- `$HERMES/providers/base.py:111` - message preprocessing hook.
- `$HERMES/providers/base.py:119` - `extra_body` hook.
- `$HERMES/providers/base.py:128` - split provider kwargs hook.
- `$HERMES/providers/base.py:162` - live model catalog fetch with fallback policy.
- `$HERMES/providers/__init__.py:1` - provider plugin registry design.
- `$HERMES/providers/__init__.py:53` - `register_provider`.
- `$HERMES/providers/__init__.py:65` - lookup by provider name/alias.
- `$HERMES/providers/__init__.py:140` - bundled, user, and legacy discovery order.
- `$HERMES/agent/transports/base.py:1` - transport owns data path for one API mode.
- `$HERMES/agent/transports/base.py:16` - abstract `ProviderTransport`.
- `$HERMES/agent/chat_completion_helpers.py:725` - registered provider profile path.
- `$HERMES/agent/chat_completion_helpers.py:744` - profile forwarded into kwargs building.
- `$HERMES/agent/chat_completion_helpers.py:766` - legacy unknown-provider fallback path.
- `$HERMES/agent/agent_init.py:365` - API mode upgrade logic for GPT-5/OpenAI-style providers with Azure exception.
- `$HERMES/agent/gemini_native_adapter.py:145` - provider-specific error shape made classifier-compatible.
- `$HERMES/plugins/model-providers/README.md` - provider plugin documentation.
- `$HERMES/pyproject.toml:45` - OpenAI SDK is core.
- `$HERMES/pyproject.toml:120` - Anthropic SDK is optional/provider-specific.
- `$HERMES/pyproject.toml:193` - Bedrock dependency is optional.

## Design and Rationale

Profiles are declarative by design. The module doc says they describe provider behavior and do not own client construction, credential rotation, or streaming (`$HERMES/providers/base.py:1`). This is a strong choice because provider-specific quirks tend to sprawl. Hermes limits them to fields and narrow hooks.

Transports own conversion and normalization for a single API mode (`$HERMES/agent/transports/base.py:1`). This keeps "Anthropic Messages", "OpenAI chat completions", "Responses", "Gemini native", and other modes from turning the central loop into format-specific code.

Provider plugins can be bundled or user-provided, and user plugins can override bundled profiles (`$HERMES/providers/__init__.py:140`). That gives extensibility without requiring changes to the main runtime.

Provider differences are not just request quirks. They are product and policy differences: context limits, tool-call support, image/audio support, reasoning fields, JSON/schema reliability, streaming shape, prompt-cache semantics, parallel tool behavior, data retention, region, cost, latency, and safety policy. A new framework should make those capabilities explicit and testable instead of relying only on profile fields.

## Integration and Coupling

Provider adapters couple to:

- Retry/failover, because errors must classify consistently.
- Tool schema conversion, because providers differ in tool-call format.
- Vision support and multimodal tool-result policy.
- Prompt caching and request kwargs.
- Credential pool and auth setup.
- Model picker/catalog behavior.

Fallback requires consent and policy. If a primary provider fails, sending a full personal-assistant context to a second provider may violate user expectations even if it succeeds technically. Provider routing should understand data sensitivity and user-approved provider classes.

Hermes' config surface already reflects how many provider decisions exist outside pure transport code: provider overrides, fallback providers, auxiliary task providers, tool-gateway credentials, OAuth settings, and provider-specific keys all live in config/env/auth surfaces (`$HERMES/hermes_cli/config.py:810`, `$HERMES/hermes_cli/config.py:1225`, `$HERMES/hermes_cli/config.py:2215`). A new framework should treat provider selection as policy plus capability plus cost, not only a model string.

## Capability Matrix Target

| Capability | Required contract |
| --- | --- |
| Tools | Supported schema shape, parallelism, tool-result media, error format. |
| Context | Hard/soft token limits, compression strategy, long-context tiers. |
| Media | Images, audio, screenshots, file parts, size limits. |
| Reasoning | Hidden reasoning fields, signatures, replay requirements. |
| Streaming | Incremental usage, cancellation, partial tool calls. |
| Policy | Retention, region, logging, fallback eligibility. |
| Cost/latency | Pricing source, observed latency, budget class. |

Contract tests should exercise each provider mode against the framework's required behavior before it is eligible for automatic routing.

The coupling is centralized mostly in `chat_completion_helpers` and transports, which is better than letting every provider fork the conversation loop.

## Lessons for a New Framework

- Make provider quirks declarative when possible.
- Keep client lifecycle, retry, fallback, and streaming in the runtime.
- Use transport classes for API-mode format conversion.
- Normalize provider exceptions into the shared retry classifier.
- Support user provider plugins, but define override/collision semantics.
- Keep provider-specific dependencies optional unless every session needs them.
