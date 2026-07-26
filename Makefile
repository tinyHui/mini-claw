.PHONY: help check

help:
	@echo "Mini-Claw Workspace"
	@echo ""
	@echo "Commands:"
	@echo "  make help   Show this help"
	@echo "  make check  Validate the placeholder workspace layout"
	@echo ""
	@echo "No setup, install, runtime, or service commands are implemented yet."

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
	@test -f scripts/dev/README.md
	@test -f scripts/service/README.md
	@test -f docs/architecture.md
	@test -f docs/guidance/hermes/README.md
	@node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")); JSON.parse(require("node:fs").readFileSync(".pi/settings.json", "utf8"))'
	@echo "Workspace scaffold is valid."
