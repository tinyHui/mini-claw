# Mini-Claw

Lightweight Telegram bot for persistent AI conversations using Pi coding agent.

## Project Goals

- **Simple**: Minimal dependencies, single-purpose
- **Persistent**: Long-running conversations with session management
- **Subscription-friendly**: Use Claude Pro/Max or ChatGPT Plus via OAuth (no API costs)
- **Telegram-only**: One Telegram bot serves one authorized Telegram user. `TELEGRAM_USER_ID` is required and all other users are rejected.

## Tech Stack

- **Runtime**: Node.js 25+, TypeScript, pnpm
- **AI Backend**: [@mariozechner/pi-coding-agent](https://github.com/badlogic/pi-mono)
- **Telegram**: [grammY](https://grammy.dev/) (lightweight, TypeScript-native)
- **Process**: Single long-running process (systemd/pm2/tmux)

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│  Telegram   │────►│  Mini-Claw      │────►│  Pi Agent   │
│  User       │◄────│  Telegram Bot   │◄────│  Runner     │
└─────────────┘     └────────┬────────┘     └─────────────┘
                             │
                             ▼
                      SQLite (miniclaw.db)
                      ├── sessions
                      └── messages
```

### Telegram Bot (`agent/channels/telegram.ts`)

The Telegram bot owns inbound message handling, Telegram authorization, command registration, and Telegram delivery behavior.

| Method | Description |
|---|---|
| `onMessage(callback)` | Registers the orchestration callback invoked on every user message |
| `onMessageSent(callback)` | Registers a callback fired after `updateOrSendMessage` completes — use this to sync the DB instead of repeating the same arguments at the call site |
| `sendAckMessage(chatId, sessionId, content)` | Sends an immediate Telegram acknowledgement; returns the Telegram message ID or `undefined` if sending fails |
| `updateOrSendMessage(chatId, sessionId, content, telegramMessageId?)` | Delivers the final response: edits the ack message in place when possible, otherwise sends a new message. Fires `onMessageSent` once delivered. |
| `start()` / `stop()` | Bot lifecycle |

### Callback-Driven Workflow (`agent/index.ts`)

```
Telegram receives an authorized text message
  → ensureSession (create DB session if absent)
  → insertMessage (role='user', status='pending')
  → sendAckMessage
      → telegramMessageId returned  → insertAckMessage (role='assistant', status='ACK')
      → undefined returned      → no ack row inserted
  → runPiWithStreaming
      → progress: updateOrSendMessage(telegramMessageId) — edits ack in place (no DB sync)
  → updateOrSendMessage(finalContent, telegramMessageId?)
      → fires onMessageSent → updateOrInsertAssistantMessage
          → telegramMessageId present → resolveAckMessage (update ack row, status='processed')
          → telegramMessageId absent  → insertMessage (role='assistant', status='processed')
  → markMessageProcessed (user message)
```

## Directory Structure

```
mini-claw/
├── CLAUDE.md                    # This file
├── Makefile                     # Quick commands
├── package.json
├── tsconfig.json
├── .env.example                 # Environment template
├── agent/
│   ├── index.ts                 # Entry point & workflow orchestration
│   ├── channels/
│   │   └── telegram.ts          # Telegram bot adapter
│   ├── db.ts                    # SQLite init (better-sqlite3)
│   ├── session-repository.ts    # CRUD for sessions table
│   ├── message-repository.ts    # CRUD for messages table
│   ├── pi-runner.ts             # Pi agent wrapper
│   ├── logger.ts                # perfect-logger setup
│   └── config.ts                # Configuration
└── scripts/
    └── setup-pi.sh              # Pi login helper
```

## Quick Start

```bash
# 1. Install dependencies
make install

# 2. Login to AI provider (Claude/ChatGPT)
make login

# 3. Configure Telegram bot token and user ID
cp .env.example .env
# Edit .env with your TELEGRAM_BOT_TOKEN and TELEGRAM_USER_ID

# 4. Start the bot
make start
```

## Makefile Commands

| Command        | Description                                      |
| -------------- | ------------------------------------------------ |
| `make install` | Install pnpm dependencies + pi-coding-agent      |
| `make login`   | Run `pi /login` to authenticate with AI provider |
| `make dev`     | Start bot in development mode (watch)            |
| `make start`   | Start bot in production mode                     |
| `make status`  | Check Pi auth status                             |
| `make clean`   | Clean build artifacts                            |

## Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_USER_ID=123456

# Optional
MINI_CLAW_WORKSPACE=/path/to/workspace  # Default: ~/mini-claw-workspace
MINI_CLAW_SESSION_DIR=~/.mini-claw/sessions
MINI_CLAW_APP_ROOT=/path/to/mini-claw    # Default: current process cwd
MINI_CLAW_CRON_DIR=/path/to/mini-claw/cron
PI_THINKING_LEVEL=low                   # low | medium | high

# Rate Limiting & Timeouts (all in milliseconds)
RATE_LIMIT_COOLDOWN_MS=5000             # Default: 5 seconds between messages
PI_TIMEOUT_MS=300000                    # Default: 5 minutes
SHELL_TIMEOUT_MS=60000                  # Default: 60 seconds
SESSION_TITLE_TIMEOUT_MS=10000          # Default: 10 seconds
```

## Session Management

- Mini-Claw keeps one active DB session at a time
- Session file: `~/.mini-claw/sessions/<timestamp>_<session_id>.jsonl`
- Pi handles auto-compaction when context window fills
- Full history preserved in JSONL, compacted context for AI

## Bot Commands

| Command    | Description                                                        |
| ---------- | ------------------------------------------------------------------ |
| `/new`     | Start a new session (resets conversation context without history)  |
| `/status`  | Show chat ID, workspace, and session state                         |
| `/cron`    | List, enable, or disable cron jobs                                 |
| `/cron restart` | Reload the pm2 cron scheduler                                |

## Authentication Flow

```
1. Run `make login` (or `pi /login`)
2. Select provider: Anthropic (Claude) or OpenAI (ChatGPT)
3. Complete OAuth in browser
4. Credentials saved to ~/.pi/agent/auth.json
5. Bot uses same credentials automatically
```

## Concurrency Handling

- Uses AsyncLock to prevent concurrent Pi executions per chat
- Queue system for rapid-fire messages
- Typing indicator while processing

## Development

```bash
# Watch mode
make dev

# Type check
pnpm typecheck

# Lint
pnpm lint
```

## Deployment

### Option 1: pm2 + systemd (Linux)

```bash
make install-service  # Configures systemd to start pm2
pm2 status
systemctl status pm2-$USER
```

### Option 2: pm2

```bash
pnpm pm2:start
pm2 save
```

This starts the Telegram agent (`mini-claw`), Bree scheduler
(`mini-claw-cron`), and cron output dispatcher (`mini-claw-mailman`). Cron jobs
are authored through normal agent requests and the `cron-job-authoring` skill,
not Telegram `/cron` commands.

### Option 3: tmux (manual)

```bash
tmux new -s mini-claw
make start
# Ctrl+B, D to detach
```

## Limitations

- Single chat = single session (no multi-user routing)
- Requires Pi to be authenticated first
- No rich media (images/voice) in v1
- Sequential message processing (no parallel)

## Future Ideas

- [ ] Voice message transcription
- [ ] Image analysis (vision models)
- [ ] Multiple workspace support
- [ ] Inline keyboard for model switching
- [ ] Session backup/restore commands

## Troubleshooting

### "Pi not authenticated"

```bash
make login
# or
pi /login
```

### "Session file locked"

Another Pi process might be running. Check:

```bash
ps aux | grep pi
```

### "Context overflow"

Pi should auto-compact, but you can force:

```bash
# In Telegram
/compact
```

## License

MIT
