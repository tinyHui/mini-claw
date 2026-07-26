# Mini-Claw Workspace

This repository is a clean workspace for building a personal daily-use bot on
top of Pi. Pi supplies the CLI, agent core, sessions, and SDK. This workspace
supplies project guidance, local Pi resources, reusable Pi packages, and the
operational tooling needed to run the eventual bot.

The repository is intentionally only a scaffold. It does not currently contain
a bot runtime, installed Pi packages, working extensions, service units, or
setup automation.

## Structure

```text
.pi/
  settings.json       Empty project-local Pi package configuration
  extensions/         Workspace-local Pi extensions
  skills/             Workspace-local agent skills
  prompts/            Workspace-local prompt templates
  themes/             Workspace-local themes
packages/             Future reusable or installable Pi packages
scripts/
  dev/                Future development environment utilities
  service/            Future systemd user-service utilities
docs/
  architecture.md     Ownership and architecture boundaries
  guidance/           Design research retained for future work
AGENTS.md              Instructions loaded by Pi and other coding agents
```

Pi calls distributable bundles of extensions, skills, prompts, and themes
“packages.” In this workspace, `.pi/` is for resources used directly by the
personal bot workspace, while `packages/` is reserved for independently
packaged components.

## Current Commands

```bash
make help
make check
```

`make check` validates only the scaffold. It does not install dependencies,
download packages, authenticate Pi, or start a service.

## Next Phase

Runtime dependencies, package sources, extension implementations, and service
entry points should be selected only when bot implementation begins. Do not
restore the previous custom Telegram, SQLite, cron, or agent-loop architecture
as a starting point.
