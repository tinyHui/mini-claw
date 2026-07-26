# Development Utilities

This directory is reserved for small, auditable development helpers.

Future utilities may cover environment diagnostics, bootstrap checks, and
dependency updates. They must be explicit about side effects and must not
silently install Pi packages, change authentication, or overwrite local state.

`preflight.sh` performs read-only host checks. It never installs packages.
