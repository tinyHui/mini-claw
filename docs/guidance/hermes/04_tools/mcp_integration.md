# MCP Integration

## Overview

Hermes supports MCP both as a client of external MCP servers and as a server exposing Hermes conversations/channels as tools. MCP expands capability discovery but also expands the attack surface: tool metadata, remote URLs, environment variables, auth tokens, process management, and tool-result content all become security boundaries.

## Code References

- `$HERMES/tools/mcp_tool.py:1` - MCP module doc: stdio/http/sse, reconnect, env filtering, credential stripping, timeouts, background loop, sampling, parallel opt-in.
- `$HERMES/tools/mcp_tool.py:170` - optional imports/backcompat flags.
- `$HERMES/tools/mcp_tool.py:260` - defaults for tool timeout, reconnect retries, safe env keys.
- `$HERMES/tools/mcp_tool.py:303` - credential pattern detection.
- `$HERMES/tools/mcp_tool.py:328` - `_build_safe_env` filters inherited environment.
- `$HERMES/tools/mcp_tool.py:351` - `_sanitize_error` strips secrets.
- `$HERMES/tools/mcp_tool.py:373` - MCP description prompt-injection warning patterns.
- `$HERMES/tools/mcp_tool.py:438` - stdio command resolution with filtered PATH.
- `$HERMES/tools/mcp_tool.py:499` - image block caching into media tags.
- `$HERMES/tools/mcp_tool.py:548` - remote URL validation classes.
- `$HERMES/tools/mcp_tool.py:620` - remote MCP URL validation function.
- `$HERMES/mcp_serve.py:1` - Hermes MCP server module doc.
- `$HERMES/mcp_serve.py:71` - SessionDB lookup fail-open.
- `$HERMES/mcp_serve.py:187` - event bridge polls DB and event queue.
- `$HERMES/pyproject.toml:174` - optional `mcp==1.26.0` dependency with Starlette pin.

## Design and Rationale

Hermes does not treat MCP server metadata as trusted. It scans descriptions for suspicious instruction content and sanitizes errors. That reflects a broader industry concern: tool metadata can carry prompt injection even before the model invokes the tool.

The environment filtering is a strong design point. Stdio MCP servers are subprocesses, and inheriting the full agent environment can leak provider keys, OAuth tokens, and profile paths. Hermes builds a safe baseline plus explicit env rather than passing everything through.

Remote URL validation is also important. MCP over HTTP/SSE turns the agent into a client of arbitrary endpoints, so SSRF-like concerns and credential handling become relevant.

MCP sampling is a separate trust boundary. When a server can ask the host to perform model calls, the server is no longer just exposing tools; it is delegating work back through the assistant's model access and context policy. That path should require explicit consent, context minimization, quotas, logging, and a denial-by-default posture for sensitive sessions. Hermes includes sampling-related plumbing in the MCP module doc (`$HERMES/tools/mcp_tool.py:1`); a new framework should treat it as privileged.

## Integration and Coupling

MCP is coupled to:

- Tool registry/dynamic discovery.
- Credential storage and environment isolation.
- Media handling, because tools can return image blocks.
- Gateway/server event bridge, when Hermes exposes conversations over MCP.
- Packaging/dependency policy, because MCP pulls Starlette/FastAPI surfaces that need vulnerability pinning.

Resources, prompts, images, and server-provided content deserve the same suspicion as tools. Hermes logs prompt/resource list changes and has handlers for listing prompts (`$HERMES/tools/mcp_tool.py:1227`, `$HERMES/tools/mcp_tool.py:2939`), but prompt injection can enter through any model-visible MCP payload, not just tool descriptions.

Parallel execution should be conservative. A server flag cannot prove that two tools are safe to run together. A host should default to serial unless tool metadata includes idempotency, resource locks, and side-effect classes that the host can enforce.

## Failure Modes

| Failure | Impact | New-framework target |
| --- | --- | --- |
| Tool description poisoning | Model follows server instructions instead of user/system policy | Scan, label, and isolate metadata. |
| Sampling leaks context | MCP server receives sensitive prompt material | User consent, minimal context, audit logs. |
| Parallel side effects race | Duplicate writes or inconsistent external state | Resource locks and idempotency contracts. |
| Resource/prompt injection | Untrusted server text becomes instruction | Trust labels for all MCP content types. |

## External Discussion

The official MCP docs define MCP as a standard way for AI apps to connect to external systems, data, tools, and workflows: https://modelcontextprotocol.io/docs/getting-started/intro.

Public security discussion around MCP has emphasized prompt injection, tool poisoning, lookalike tools, and cross-tool exfiltration. I am treating these as external security context, not Hermes-specific claims. They help explain why Hermes has description scanning, tool collision controls, safe env construction, URL validation, and secret stripping.

## Lessons for a New Framework

- Treat MCP metadata as untrusted input.
- Do not pass the full process environment into MCP subprocesses.
- Sanitize errors before returning them to the model.
- Validate remote MCP URLs and auth handling.
- Keep MCP discovery out of import-time side effects.
- Make collisions between MCP and native tools explicit.
