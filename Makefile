.PHONY: help dev check build test service-install service-uninstall service-start service-stop service-restart service-status service-logs

help:
	@echo "Mini-Claw Workspace"
	@echo ""
	@echo "Commands:"
	@echo "  make help              Show this help"
	@echo "  make dev               Run daemon in foreground with TypeScript watch"
	@echo "  make check             Validate structure, config, types, and tests"
	@echo "  make build             Build the daemon"
	@echo "  make test              Run the test suite"
	@echo "  make service-install   Install the dedicated systemd user service (sudo)"
	@echo "  make service-uninstall Remove code/units but preserve user data (sudo)"
	@echo "  make service-start     Start the service (sudo)"
	@echo "  make service-stop      Stop the service (sudo)"
	@echo "  make service-restart   Restart the service (sudo)"
	@echo "  make service-status    Show service status (sudo)"
	@echo "  make service-logs      Follow service logs (sudo)"

check:
	@test -f AGENTS.md
	@test -f README.md
	@test -f package.json
	@test -f pnpm-workspace.yaml
	@test -f .pi/settings.json
	@test -d .pi/extensions
	@test -d .pi/skills
	@test -d .pi/prompts
	@test -d .pi/themes
	@test -d packages
	@test -f packages/growth-agent/src/daemon.ts
	@test -f scripts/dev/preflight.sh
	@test -f scripts/service/mini-claw.service
	@test -f docs/architecture.md
	@test -f docs/guidance/hermes/README.md
	@test ! -e Pi_Growth_Agent_PRD_Setup_Guide.md
	@node -e 'for (const f of ["package.json", ".pi/settings.json", "packages/growth-agent/package.json", "packages/growth-agent/tsconfig.json"]) JSON.parse(require("node:fs").readFileSync(f, "utf8"))'
	@! git ls-files | grep -E '(^|/)(\\.env|.*\\.db(-wal|-shm)?|secrets\\.env|telegram\\.json|auth\\.json)$$'
	@pnpm --filter @mini-claw/growth-agent check
	@pnpm --filter @mini-claw/growth-agent test
	@echo "Mini-Claw workspace is valid."

dev:
	@pnpm --filter @mini-claw/growth-agent dev

build:
	@pnpm --filter @mini-claw/growth-agent build

test:
	@pnpm --filter @mini-claw/growth-agent test

service-install: build
	@sudo ./scripts/service/install.sh

service-uninstall:
	@sudo ./scripts/service/uninstall.sh

service-start service-stop service-restart service-status service-logs:
	@sudo ./scripts/service/control.sh $(@:service-%=%)
