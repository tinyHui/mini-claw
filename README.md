# Mini-Claw

Lightweight Telegram bot for persistent AI conversations using [Pi coding agent](https://github.com/badlogic/pi-mono).

A minimalist alternative to OpenClaw - use your Claude Pro/Max or ChatGPT Plus subscription directly in Telegram, no API costs.

## Features

- **Persistent Sessions** - Conversations are saved and auto-compacted
- **Workspace Navigation** - Change directories with `/cd`, run shell commands with `/shell`
- **Session Management** - Archive, switch, and clean up old sessions
- **File Attachments** - Automatically sends files created by Pi (PDF, images, documents)
- **Rate Limiting** - Prevents message spam (configurable cooldown)
- **Access Control** - Optional allowlist for authorized users
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
                        └── telegram-<chat_id>.jsonl
```

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm
- [Pi coding agent](https://github.com/badlogic/pi-mono) installed globally

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
# Edit .env with your TELEGRAM_BOT_TOKEN

# Prepare workspace prompt and database
$EDITOR ~/mini-claw-workspace/SOUL.md
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
| `/session`     | List and manage sessions           |
| `/new`         | Start fresh session (archives old) |
| `/status`      | Show bot status                    |

## Configuration

```bash
# Required
TELEGRAM_BOT_TOKEN=your_bot_token

# Optional
MINI_CLAW_WORKSPACE=/path/to/workspace    # Default: ~/mini-claw-workspace
MINI_CLAW_SESSION_DIR=~/.mini-claw/sessions
PI_THINKING_LEVEL=low                      # low | medium | high
TELEGRAM_USER_ID=123456                    # Single authorized Telegram user ID

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
`drizzle/`, Drizzle config/schema files, and `scripts/pi/`.

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
- installs `@mariozechner/pi-coding-agent` when `pi` is missing
- downloads and extracts the release under `~/mini-claw/releases/<version>`
- updates `~/mini-claw/current`
- installs dependencies and runs `pnpm db:migrate`
- installs and restarts the `mini-claw` user `systemd` service

These parts stay manual:

```bash
$EDITOR ~/mini-claw/.env
pi /login
$EDITOR ~/mini-claw-workspace/SOUL.md
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

Mini-Claw runs as a user-level `systemd` service:

```bash
systemctl --user status mini-claw
systemctl --user restart mini-claw
journalctl --user -u mini-claw -f
```

If services do not start after reboot, enable user lingering:

```bash
sudo loginctl enable-linger "$USER"
```

### Manual systemd install from a clone

For a cloned checkout on Linux, the older Makefile helper still works:

```bash
make install-service
systemctl --user start mini-claw
systemctl --user enable mini-claw
```

### pm2

```bash
pnpm build
pm2 start dist/index.js --name mini-claw
pm2 save
```

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
- [ ] OpenClaw alike USER.md, but support multiple of them and link the relative one with each session
- [ ] Support cross session memory
- [ ] Integrate with codex
- [ ] Support scheduled jobs
- [ ] Install skills to make research work
- [ ] Support enriched files
