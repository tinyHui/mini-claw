# Mini-Claw

Lightweight Telegram bot for persistent AI conversations using [Pi coding agent](https://github.com/badlogic/pi-mono).

A minimalist alternative to OpenClaw - use your Claude Pro/Max or ChatGPT Plus subscription directly in Telegram, no API costs.

## Features

- **Persistent Sessions** - Conversations are saved and auto-compacted
- **Workspace Navigation** - Change directories with `/cd`, run shell commands with `/shell`
- **Session Management** - Archive, switch, and clean up old sessions
- **File Attachments** - Automatically sends files created by Pi (PDF, images, documents)
- **Rate Limiting** - Prevents message spam (configurable cooldown)
- **Access Control** - Required single-user Telegram authorization
- **Typing Indicators** - Shows activity while AI is processing

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Telegram   │────►│  Mini-Claw  │────►│  Pi Agent   │
│   (User)    │◄────│   (Bot)     │◄────│  (Session)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ~/.mini-claw/
                    └── sessions/
                        └── <timestamp>_<session_id>.jsonl
```

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm
- [Pi coding agent](https://github.com/badlogic/pi-mono) installed globally
- pm2 and Codex installed globally for production deployment

### Installation

```bash
# Clone and install
git clone https://github.com/yourusername/mini-claw
cd mini-claw
pnpm install

# Login to AI provider (Claude or ChatGPT)
pi /login

# Configure bot token
cp .env.example .env
# Edit .env with your TELEGRAM_BOT_TOKEN and TELEGRAM_USER_ID

# Prepare workspace prompt, memory files, and database
$EDITOR ~/mini-claw-workspace/SOUL.md
$EDITOR ~/mini-claw-workspace/MEMORY.md
$EDITOR ~/mini-claw-workspace/USER.md
pnpm db:migrate

# Start the bot
pnpm start
```

### Using Make

```bash
make install    # Install dependencies
make login      # Authenticate with AI provider
make dev        # Development mode (watch)
make start      # Production mode
make test       # Run tests
```

## Bot Commands

| Command        | Description                        |
| -------------- | ---------------------------------- |
| `/start`       | Welcome message                    |
| `/help`        | Show all commands                  |
| `/pwd`         | Show current working directory     |
| `/cd <path>`   | Change working directory           |
| `/home`        | Go to home directory               |
| `/shell <cmd>` | Run shell command directly         |
| `/new`         | Start fresh session (archives old) |
| `/status`      | Show bot status                    |
| `/cron`        | List, enable, or disable cron jobs |
| `/cron restart` | Reload the pm2 cron scheduler     |
| `/memory`      | Review memory proposals            |

## Configuration

```bash
# Required
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_USER_ID=123456                    # Single authorized Telegram user ID

# Optional
MINI_CLAW_WORKSPACE=/path/to/workspace    # Default: ~/mini-claw-workspace
MINI_CLAW_SESSION_DIR=~/.mini-claw/sessions
MINI_CLAW_APP_ROOT=/path/to/mini-claw      # Default: current process cwd
MINI_CLAW_CRON_DIR=/path/to/mini-claw/generated/cron # Default: $MINI_CLAW_APP_ROOT/generated/cron
PI_THINKING_LEVEL=low                      # low | medium | high
MINI_CLAW_MEMORY_REVIEW_ENABLED=true       # Periodic self-learning memory review
MINI_CLAW_MEMORY_REVIEW_INTERVAL_MS=3600000
MINI_CLAW_MEMORY_REVIEW_BATCH_LIMIT=40

# Rate limiting & timeouts (milliseconds)
RATE_LIMIT_COOLDOWN_MS=5000                # Default: 5 seconds
PI_TIMEOUT_MS=300000                       # Default: 5 minutes
SHELL_TIMEOUT_MS=60000                     # Default: 60 seconds

# Web search (optional)
BRAVE_API_KEY=your_brave_api_key           # For Pi web search skill
```

## Deployment

Mini-Claw is designed to run on a Raspberry Pi from GitHub release tarballs.
The deployment flow keeps secrets and local state outside each release directory,
so redeploying does not overwrite `.env`, Pi auth, the database, sessions, or
the workspace.

### Release Tags

Push a version tag to build and publish a GitHub Release artifact:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The GitHub Action builds `dist/`, runs checks, and publishes:

```text
mini-claw-v0.1.0.tar.gz
```

The tarball includes the runtime files needed on the Pi, including
`package.json`, `pnpm-lock.yaml`, `Makefile`, `.env.example`, `dist/`,
`cron/`, `skills/`, `drizzle/`, Drizzle config/schema files, and `scripts/pi/`.

You can create the same package locally:

```bash
make release-package
```

### First Raspberry Pi Setup

On a fresh Raspberry Pi, download the deploy script from the public repo and run
it. Omit `--version` to install the latest GitHub Release.

```bash
curl -fsSL https://raw.githubusercontent.com/tinyHui/mini-claw/main/scripts/pi/deploy.sh -o deploy-mini-claw.sh
chmod +x deploy-mini-claw.sh
./deploy-mini-claw.sh --version v0.1.0
```

The deploy script:

- installs host dependencies with `apt` when missing
- installs `nvm`, Node.js 22, and pnpm
- installs `@mariozechner/pi-coding-agent`, `pm2`, and `@openai/codex` when missing
- downloads and extracts the release under `~/mini-claw/releases/<version>`
- updates `~/mini-claw/current`
- installs dependencies and runs `pnpm db:migrate`
- creates or refreshes the generated `pm2-$USER` systemd service
- starts or reloads `mini-claw`, `mini-claw-cron`, and `mini-claw-mailman` through pm2

These parts stay manual:

```bash
$EDITOR ~/mini-claw/.env
pi /login
$EDITOR ~/mini-claw-workspace/SOUL.md
$EDITOR ~/mini-claw-workspace/MEMORY.md
$EDITOR ~/mini-claw-workspace/USER.md
```

At minimum, set `TELEGRAM_BOT_TOKEN` in `~/mini-claw/.env`. The Pi login is not
automated because it requires interactive provider authentication.

### Redeploy

For future releases, run the same script with the new tag:

```bash
~/deploy-mini-claw.sh --version v0.1.1
```

Or deploy the latest GitHub Release:

```bash
~/deploy-mini-claw.sh
```

The script is idempotent: already installed tools are reused, existing `.env`
is preserved, and the service is updated to point at the new release.

### Service Management

systemd starts pm2 on boot, and pm2 manages the Node processes:

```bash
systemctl status pm2-$USER
pm2 status
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 logs mini-claw mini-claw-cron mini-claw-mailman
```

If pm2 loses its process list after manual changes, save it again:

```bash
pm2 save
```

### Manual pm2 systemd install from a clone

For a cloned checkout on Linux:

```bash
make install-service
```

### pm2

```bash
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME"
pnpm pm2:start
pm2 save
sudo systemctl enable --now pm2-$USER
```

This starts `mini-claw`, `mini-claw-cron`, and `mini-claw-mailman` from `ecosystem.config.cjs`.
Cron jobs are created by normal Telegram requests that the agent handles with
the `cron-job-authoring` skill; there are no `/cron` Telegram commands. Cron
job output is written to the `mailbox` table and delivered by mailman.

### tmux

```bash
tmux new -s mini-claw
pnpm start
# Ctrl+B, D to detach
```

## Development

```bash
# Run in watch mode
pnpm dev

# Type checking
pnpm typecheck

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage
```

## Tech Stack

- **Runtime**: Node.js 22+, TypeScript
- **Telegram**: [grammY](https://grammy.dev/)
- **AI**: [Pi coding agent](https://github.com/badlogic/pi-mono)
- **Testing**: Vitest

## TODO

- [x] Handle image
- [x] Handle other types of files (basic)
- [X] Use sqlite3 to store messsages
- [X] pi-mono core agent SDK to replace the interactive cli
- [X] Sandbox restriction for all bash execution
- [X] OpenClaw alike SOUL.md updated
- [x] OpenClaw alike USER.md workspace memory bootstrap and prompt loading
- [x] Support cross session memory through MEMORY.md/USER.md and periodic proposal review
- [x] Integrate with codex
- [x] Support scheduled jobs
- [ ] Install skills to make research work
- [ ] Support enriched files
