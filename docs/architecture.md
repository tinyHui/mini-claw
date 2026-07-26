# Architecture Direction

## Principle

Build the personal bot by composing Pi rather than recreating an agent
framework. Pi remains the upstream owner of its CLI, core runtime, model
integration, tools, sessions, and SDK.

## Workspace Responsibilities

This repository owns:

- project instructions and design guidance;
- workspace-local extensions, skills, prompts, and themes;
- reusable Pi packages developed for the personal bot;
- development diagnostics and maintenance helpers;
- future systemd user-service lifecycle tooling.

It does not currently own a communication channel, persistence database,
scheduler, memory implementation, or background delivery process.

## Extension Model

Use `.pi/` for resources that belong directly to this workspace. Use
`packages/` when a capability needs its own manifest, dependencies, versioning,
or reuse boundary. Prefer these native extension points before introducing
wrapper services or modifying Pi internals.

## Deferred Decisions

The bot entry point, SDK surface, package versions, communication channels,
state model, and service command are intentionally deferred until the
implementation phase. This cleanup must not choose or install them.
