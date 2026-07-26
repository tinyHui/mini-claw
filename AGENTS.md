# Mini-Claw Workspace Guidance

## Purpose

This repository is the guidance, extension, package, and operations workspace
for a personal daily-use bot built on Pi.

The current state is intentionally a placeholder. Do not assume a bot runtime,
service entry point, package dependency, communication channel, persistence
layer, or deployment mechanism exists.

## Architecture Boundaries

- Pi owns the CLI, agent loop, model/provider integration, sessions, core tools,
  and SDK behavior.
- Prefer Pi-native extensions, skills, prompts, themes, and packages over
  changes that duplicate or fork Pi internals.
- Put resources used only by this workspace under `.pi/`.
- Put independently reusable Pi packages under `packages/<package-name>/`.
- Keep guidance and design evidence under `docs/`.
- Put development helpers under `scripts/dev/` and Linux systemd user-service
  helpers under `scripts/service/`.

## Working Rules

- Do not commit credentials, provider tokens, auth state, installed packages,
  generated output, or session data.
- Do not add dependencies or download Pi packages as part of placeholder or
  documentation-only work.
- A future service implementation must expose install, uninstall, start, stop,
  restart, status, and logs operations and must preserve user data on removal.
- Keep the root Makefile as the discoverable command index.
- Run `make check` after changing the workspace structure.

## Current Commands

- `make help` describes the available workspace commands.
- `make check` validates the placeholder layout and JSON syntax.
