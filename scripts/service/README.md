# System Service Utilities

This directory contains Linux systemd user-service tooling for the dedicated
`growth-agent` account.

The eventual interface must cover:

- install and uninstall;
- start, stop, and restart;
- status and logs;
- idempotent upgrades;
- preservation of credentials, sessions, and user data.

`install.sh` deploys an already-built pnpm package. It does not install host or
npm dependencies and never imports repository secrets. `uninstall.sh` preserves
all state in `/var/lib/growth-agent`.
