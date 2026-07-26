# Operations

- Daily reports run at 07:00 Europe/London.
- All connectors begin in draft mode. Set `dryRunUntil` at least seven days
  after the first successful draft-only acceptance run.
- Enable platforms one at a time: Reddit, X if its MCP gate passed, then
  Rednote.
- Keep the daily write cap at one per platform.
- X remains draft-only if DataWhisker fails review; do not silently replace it.
- Rednote login uses an SSH port forward to its loopback endpoint.
- Stop heavy work when `/health` reports disk or thermal pressure.

No automated backup is configured. The microSD is a single point of failure.
