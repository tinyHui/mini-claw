.PHONY: install login dev start build status clean help test test-watch test-coverage lint typecheck check release-package pi-bootstrap pi-deploy pi-status pm2-start pm2-restart pm2-logs install-service pw-install pw-dev pw-build

# Default target
help:
	@echo "Mini-Claw - Lightweight Telegram AI Bot"
	@echo ""
	@echo "Quick Start:"
	@echo "  make install    Install dependencies"
	@echo "  make login      Authenticate with AI provider (Claude/ChatGPT)"
	@echo "  make dev        Start in development mode"
	@echo ""
	@echo "Commands:"
	@echo "  make install    Install pnpm dependencies + runtime CLIs"
	@echo "  make login      Run 'pi /login' to authenticate"
	@echo "  make dev        Start bot with hot reload"
	@echo "  make start      Start bot in production mode"
	@echo "  make build      Compile TypeScript"
	@echo "  make status     Check Pi auth status"
	@echo "  make pm2-start  Start Mini-Claw, cron, and mailman under pm2"
	@echo "  make clean      Remove build artifacts"
	@echo "  make release-package  Build local release tarball"
	@echo ""
	@echo "Quality:"
	@echo "  make test       Run tests"
	@echo "  make lint       Run ESLint"
	@echo "  make typecheck  Run TypeScript type checking"
	@echo "  make check      Run all checks (lint + typecheck + test)"
	@echo ""
	@echo "Playwright Skill:"
	@echo "  make pw-install Install and link pw CLI globally"
	@echo "  make pw-build   Build Playwright skill"
	@echo "  make pw-dev     Start Playwright skill in dev mode"
	@echo ""
	@echo "Setup:"
	@echo "  1. make install"
	@echo "  2. make login"
	@echo "  3. cp .env.example .env && edit .env"
	@echo "  4. Create SOUL.md, MEMORY.md, and USER.md in your MINI_CLAW_WORKSPACE"
	@echo "  5. pnpm db:migrate"
	@echo "  6. make dev"
	@echo ""
	@echo "Raspberry Pi Deployment:"
	@echo "  make pi-bootstrap  Install Pi host prerequisites"
	@echo "  make pi-deploy     Download latest GitHub release and restart service"
	@echo "  make pi-status     Show pm2 and pm2 systemd status"

# Install dependencies
install:
	@echo "Installing pnpm dependencies..."
	pnpm install
	@echo ""
	@echo "Checking pi-coding-agent..."
	@which pi > /dev/null 2>&1 || (echo "Installing pi-coding-agent globally..." && npm install -g @mariozechner/pi-coding-agent)
	@echo ""
	@echo "Checking pm2..."
	@which pm2 > /dev/null 2>&1 || (echo "Installing pm2 globally..." && npm install -g pm2)
	@echo ""
	@echo "Checking codex..."
	@which codex > /dev/null 2>&1 || (echo "Installing codex globally..." && npm install -g @openai/codex)
	@echo ""
	@echo "Done! Next steps:"
	@echo "  1. Run 'make login' to authenticate with Claude/ChatGPT"
	@echo "  2. Copy .env.example to .env and add your Telegram bot token"
	@echo "  3. Create SOUL.md, MEMORY.md, and USER.md in your MINI_CLAW_WORKSPACE"
	@echo "  4. Run 'pnpm db:migrate'"
	@echo "  5. Run 'make dev' to start the bot"

# Login to AI provider
login:
	@echo "Starting Pi login..."
	@echo "Select your AI provider (Anthropic for Claude, OpenAI for ChatGPT)"
	@echo ""
	pi /login

# Development mode with hot reload
dev:
	@test -f .env || (echo "Error: .env file not found. Copy .env.example to .env first." && exit 1)
	pnpm dev

# Production start
start:
	@test -f .env || (echo "Error: .env file not found." && exit 1)
	pnpm build
	pnpm start

pm2-start:
	pnpm pm2:start

pm2-restart:
	pnpm pm2:restart

pm2-logs:
	pnpm pm2:logs

# Build TypeScript
build:
	pnpm build

# Check Pi status
status:
	@echo "Checking Pi installation..."
	@which pi > /dev/null 2>&1 && echo "Pi: installed at $$(which pi)" || echo "Pi: NOT INSTALLED"
	@echo ""
	@echo "Checking Pi auth..."
	@pi --version 2>/dev/null && echo "Pi: OK" || echo "Pi: not authenticated or not working"

# Run tests
test:
	pnpm test

# Run tests in watch mode
test-watch:
	pnpm test:watch

# Run tests with coverage
test-coverage:
	pnpm test:coverage

# Run ESLint
lint:
	pnpm lint

# Run TypeScript type checking
typecheck:
	pnpm typecheck

# Run all checks
check: lint typecheck test

# Build local release tarball matching GitHub Actions packaging.
release-package:
	rm -rf dist
	pnpm build
	@VERSION="$${VERSION:-v$$(node -p 'require("./package.json").version')}" ; \
	PACKAGE_DIR="mini-claw-$$VERSION" ; \
	ARTIFACT="mini-claw-$$VERSION.tar.gz" ; \
	rm -rf "$$PACKAGE_DIR" "$$ARTIFACT" ; \
	mkdir -p "$$PACKAGE_DIR/agent/db" ; \
	cp -R dist "$$PACKAGE_DIR/dist" ; \
	cp -R cron "$$PACKAGE_DIR/cron" ; \
	rm -rf "$$PACKAGE_DIR/cron/output" ; \
	cp -R skills "$$PACKAGE_DIR/skills" ; \
	cp -R drizzle "$$PACKAGE_DIR/drizzle" ; \
	rm -f "$$PACKAGE_DIR/drizzle/meta/_journal.json" ; \
	cp -R scripts "$$PACKAGE_DIR/scripts" ; \
	cp package.json pnpm-lock.yaml pnpm-workspace.yaml Makefile README.md .env.example drizzle.config.ts tsconfig.json ecosystem.config.cjs "$$PACKAGE_DIR/" ; \
	cp agent/db/schema.ts "$$PACKAGE_DIR/agent/db/schema.ts" ; \
	find "$$PACKAGE_DIR/dist" -name "*.test.*" -delete ; \
	find "$$PACKAGE_DIR/dist" -name "test-database.*" -delete ; \
	tar -czf "$$ARTIFACT" "$$PACKAGE_DIR" ; \
	rm -rf "$$PACKAGE_DIR" ; \
	echo "Created $$ARTIFACT"

# Raspberry Pi deployment helpers
pi-bootstrap:
	scripts/pi/bootstrap.sh

pi-deploy:
	scripts/pi/deploy.sh

pi-status:
	pm2 status
	-systemctl status pm2-$$(whoami)

# Clean build artifacts
clean:
	@command -v rip > /dev/null 2>&1 && rip dist node_modules/.cache 2>/dev/null || rm -rf dist node_modules/.cache

# Install pm2 systemd service (Linux)
install-service:
	@command -v pm2 > /dev/null 2>&1 || (echo "Error: pm2 is not installed. Run 'make install' first." && exit 1)
	@echo "Configuring systemd to start pm2 on boot..."
	sudo env PATH="$$PATH" pm2 startup systemd -u "$$(whoami)" --hp "$$HOME"
	pnpm pm2:start
	pm2 save
	sudo systemctl enable --now pm2-$$(whoami)

# Playwright skill targets
pw-install:
	@echo "Installing Playwright skill..."
	cd skills/playwright && pnpm install
	@echo ""
	@echo "Linking pw command globally..."
	cd skills/playwright && pnpm link --global
	@echo ""
	@echo "Done! Test with: pw --help"

pw-dev:
	@echo "Starting Playwright skill in dev mode..."
	cd skills/playwright && pnpm dev

pw-build:
	@echo "Building Playwright skill..."
	cd skills/playwright && pnpm build
