# Mini-Claw

Lightweight Telegram bot for persistent AI conversations using Pi coding agent.

## Project Goals

- **Simple**: Minimal dependencies, single-purpose
- **Persistent**: Long-running conversations with session management
- **Subscription-friendly**: Use Claude Pro/Max or ChatGPT Plus via OAuth (no API costs)
- **Platform-agnostic core**: The database layer, repositories, and AI processor must not reference any specific messaging platform (Telegram, Discord, etc.). Use generic terms like `sessionId`, `platformMsgId`, and `channelId` instead of platform-specific names. Only the adapter layer (e.g. `src/channels/telegram.ts`) is allowed to contain platform-specific code.

## Tech Stack

- **Runtime**: Node.js 25+, TypeScript, pnpm
- **AI Backend**: [@mariozechner/pi-coding-agent](https://github.com/badlogic/pi-mono)
- **Telegram**: [grammY](https://grammy.dev/) (lightweight, TypeScript-native)
- **Process**: Single long-running process (systemd/pm2/tmux)

## Architecture

```
┌──────────────────┐     ┌─────────────────┐     ┌─────────────┐
│  Messaging       │────►│  Channel        │────►│  Pi Agent   │
│  Platform        │◄────│  (onMessage cb) │◄────│  (Runner)   │
│  (Telegram, …)   │     └────────┬────────┘     └─────────────┘
└──────────────────┘              │
                                  ▼
                           SQLite (miniclaw.db)
                           ├── sessions
                           └── messages
```

### Channel Interface (`src/channels/channel.ts`)

All messaging platforms are abstracted behind the `Channel` interface. Only the concrete adapter (e.g. `src/channels/telegram.ts`) contains platform-specific code.

| Method | Description |
|---|---|
| `onMessage(callback)` | Registers the orchestration callback invoked on every user message |
| `onMessageSent(callback)` | Registers a callback fired after `updateOrSendMessage` completes — use this to sync the DB instead of repeating the same arguments at the call site |
| `sendAckMessage(sessionId, content)` | Sends an immediate acknowledgement; returns `platformMsgId` or `undefined` if the platform does not support ack messages |
| `updateOrSendMessage(sessionId, content, platformMsgId?)` | Delivers the final response: edits the ack message in place when `platformMsgId` is provided, otherwise sends a new message. Falls back to a new message if the edit fails. Fires `onMessageSent` once delivered. |
| `start()` / `stop()` | Channel lifecycle |

### Callback-Driven Workflow (`src/index.ts`)

```
channel receives message
  → ensureSession (create DB session if absent)
  → insertMessage (role='user', status='pending')
  → sendAckMessage
      → platformMsgId returned  → insertAckMessage (role='assistant', status='ACK')
      → undefined returned      → no ack row inserted
  → runPiWithStreaming
      → progress: updateOrSendMessage(platformMsgId) — edits ack in place (no DB sync)
  → updateOrSendMessage(finalContent, platformMsgId?)
      → fires onMessageSent → updateOrInsertAssistantMessage
          → platformMsgId present → resolveAckMessage (update ack row, status='processed')
          → platformMsgId absent  → insertMessage (role='assistant', status='processed')
  → markMessageProcessed (user message)
```

### Adding a New Channel

1. Create `src/channels/<platform>.ts` implementing `Channel`
2. Instantiate it in `src/index.ts` and register `onMessage` + `onMessageSent`
3. `sendAckMessage` may return `undefined` if the platform has no ack concept — the rest of the workflow handles both cases
4. No changes required to repositories, DB, or Pi runner

## Directory Structure

```
mini-claw/
├── CLAUDE.md                    # This file
├── Makefile                     # Quick commands
├── package.json
├── tsconfig.json
├── .env.example                 # Environment template
├── src/
│   ├── index.ts                 # Entry point & workflow orchestration
│   ├── channels/
│   │   ├── channel.ts           # Channel interface (platform-agnostic)
│   │   └── telegram.ts          # Telegram adapter (implements Channel)
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

# 3. Configure Telegram bot token
cp .env.example .env
# Edit .env with your TELEGRAM_BOT_TOKEN

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

# Optional
MINI_CLAW_WORKSPACE=/path/to/workspace  # Default: ~/mini-claw-workspace
MINI_CLAW_SESSION_DIR=~/.mini-claw/sessions
PI_THINKING_LEVEL=low                   # low | medium | high
ALLOWED_USERS=123,456                   # Comma-separated user IDs (empty = allow all)

# Rate Limiting & Timeouts (all in milliseconds)
RATE_LIMIT_COOLDOWN_MS=5000             # Default: 5 seconds between messages
PI_TIMEOUT_MS=300000                    # Default: 5 minutes
SHELL_TIMEOUT_MS=60000                  # Default: 60 seconds
SESSION_TITLE_TIMEOUT_MS=10000          # Default: 10 seconds
```

## Session Management

- Each Telegram chat gets its own Pi session file
- Session file: `~/.mini-claw/sessions/telegram-<chat_id>.jsonl`
- Pi handles auto-compaction when context window fills
- Full history preserved in JSONL, compacted context for AI

## Bot Commands

| Command    | Description                                                    |
| ---------- | -------------------------------------------------------------- |
| `/session` | Start a new session (resets conversation context, keeps history) |
| `/status`  | Show chat ID, workspace, and session state                     |

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

### Option 1: systemd (Linux)

```bash
make install-service  # Creates systemd user service
systemctl --user start mini-claw
systemctl --user enable mini-claw
```

### Option 2: pm2

```bash
pnpm build
pm2 start dist/index.js --name mini-claw
pm2 save
```

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
