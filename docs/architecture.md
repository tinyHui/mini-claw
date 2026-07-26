# Architecture

## Principle

Build the personal bot by composing Pi rather than recreating an agent
framework. Pi remains the upstream owner of its CLI, core runtime, model
integration, tools, sessions, and SDK.

## Runtime

Mini-Claw is a modular monolith. A single daemon owns Telegram dispatch,
durable scheduling, evidence/report state, approvals, and connector policy.
Agent turns are created through the Pi SDK; the daemon never parses Pi CLI
output.

The daemon exposes three profiles:

- research: approved network sources and report storage, without publishers;
- coding: an explicit repository root inside fail-closed bubblewrap;
- publisher: immutable draft input and one typed connector call after approval.

SQLite is the application source of truth. Drizzle defines and queries the
relational schema, while Zod validates configuration and application boundary
objects. Pi remains the source of truth for agent sessions and provider
authentication.

## Workspace Responsibilities

This repository owns:

- project instructions and design guidance;
- workspace-local extensions, skills, prompts, and themes;
- reusable Pi packages developed for the personal bot;
- development diagnostics and maintenance helpers;
- systemd user-service lifecycle tooling.

It does not own model/provider integration, the agent loop, Pi session
semantics, or Pi core tools.

## Extension Model

Use `.pi/` for resources that belong directly to this workspace. Use
`packages/` when a capability needs its own manifest, dependencies, versioning,
or reuse boundary. Prefer these native extension points before introducing
wrapper services or modifying Pi internals.

## Host boundary

Production uses a locked `growth-agent` Linux account and a lingering systemd
user manager. Rednote browser automation is a separate rootless container user
service bound to loopback. Neither the model nor general-purpose tools receive
sudo, a container socket, service credentials, or access to the developer home.
