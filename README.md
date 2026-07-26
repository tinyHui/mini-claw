# Mini-Claw Workspace

This repository contains Mini-Claw, a Pi-native local growth agent for a
single owner. Pi supplies the model/provider integration, agent loop, sessions,
and core tools. This workspace supplies the durable application policy,
Telegram control surface, research/report pipeline, publishing approval gate,
project-local Pi resources, and Raspberry Pi service tooling.

The production target is a 64-bit Raspberry Pi 4 with 4 GB RAM and a
high-endurance microSD card. The Mac remains the development and administration
client.

## Structure

```text
.pi/                  Workspace-local Pi extensions, skills, and prompts
packages/
  growth-agent/       TypeScript daemon and application policy
scripts/
  dev/                Read-only host/package diagnostics
  service/            systemd user-service lifecycle tooling
docs/
  architecture.md     Runtime boundaries and data flow
  product/            Product requirements and target decisions
  runbooks/           Installation and operations
AGENTS.md              Instructions loaded by Pi and other coding agents
```

Pi calls distributable bundles of extensions, skills, prompts, and themes
“packages.” In this workspace, `.pi/` is for resources used directly by the
personal bot workspace, while `packages/` is reserved for independently
packaged components.

## Commands

```bash
make help
make dev
make check
make build
make test
make service-install
make service-start
make service-status
make service-logs
```

`make dev` runs the daemon in the foreground with a safe local configuration
and restarts it when TypeScript files change. Telegram and research sources stay
disabled unless explicitly configured in the environment/local configuration.

Service installation is explicit and privileged. It never imports `.env`
automatically, and uninstall preserves `/var/lib/growth-agent`.
