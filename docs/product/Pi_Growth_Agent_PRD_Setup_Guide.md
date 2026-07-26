# Local Pi Growth Agent

## Product Requirements Document + Raspberry Pi Setup Guide

A small, local-first Pi agent that turns daily technical signals into useful founder insight, drafts content in your voice, and publishes only after explicit Telegram approval.

| **Field**               | **Value**                                                                  |
|-------------------------|----------------------------------------------------------------------------|
| **Status**              | Draft for package selection                                                |
| **Version**             | 0.1                                                                        |
| **Date**                | 26 July 2026                                                               |
| **Primary operator**    | Solo developer (single-owner Telegram bot)                                 |
| **Target host**         | Raspberry Pi 5, 8 GB RAM, 64-bit Raspberry Pi OS                           |
| **Core**                | @earendil-works/pi — SDK/runtime first; CLI optional                       |
| **Operating principle** | Package-first, source-reviewed, least privilege, human-approved publishing |

> [!NOTE]
> **Product thesis:** The system is a distribution copilot for an “哑巴开发者” (“silent builder”): it should reduce the distance from building → observing users → explaining value → publishing → learning, without becoming a large general-purpose automation platform.


## Contents

1. [Executive decision](#1-executive-decision)
2. [Problem, users, and outcomes](#2-problem-users-and-outcomes)
3. [Product principles](#3-product-principles)
4. [Architecture](#4-architecture)
5. [Functional requirements](#5-functional-requirements)
6. [Non-functional requirements](#6-non-functional-requirements)
7. [Security model](#7-security-model)
8. [Pi package catalogue audit](#8-pi-package-catalogue-audit)
9. [Recommended package baseline](#9-recommended-package-baseline)
10. [Custom package specification](#10-custom-package-specification)
11. [Raspberry Pi setup guide](#11-raspberry-pi-setup-guide)
12. [Telegram, scheduling, and reports](#12-configure-telegram-scheduling-and-reports)
13. [Bubblewrap](#13-configure-bubblewrap-safely)
14. [Social publishing](#14-configure-social-publishing)
15. [Daemon operation](#15-build-and-operate-the-daemon)
16. [Testing and acceptance](#16-testing-and-acceptance)
17. [Rollout plan](#17-rollout-plan)
18. [Risks and mitigations](#18-risks-and-mitigations)
19. [Owner selection sheet](#19-owner-selection-sheet)
20. [Source index](#20-source-index)

## How to use this document

- Sections 1–7 define the product, architecture, and acceptance criteria.
- Sections 8–10 compare current Pi packages and record the recommended baseline.
- Sections 11–16 are the setup, security, testing, and rollout runbook.

Catalogue metrics are rolling monthly/weekly values observed on 26 July 2026. They are popularity signals—not security reviews, unique users, or guarantees of maintenance.

## 1. Executive decision

> [!IMPORTANT]
> **Recommended baseline:** Embed Pi through its TypeScript SDK in a small systemd daemon. Load Pi packages and skills from the project directory. Use Telegram as the operator UI, SQLite for durable state, bubblewrap for Linux coding boundaries, and an approval gate in front of every social write.

| **Capability**     | **Selected baseline**             | **Decision**                                                                       |
|--------------------|-----------------------------------|------------------------------------------------------------------------------------|
| **Agent runtime**  | @earendil-works/pi SDK            | Use createAgentSession; no CLI output parsing.                                     |
| **Telegram**       | @llblab/pi-telegram               | Prototype package; reuse/port its runtime adapter if headless compatibility fails. |
| **Scheduling**     | pi-schedule-prompt                | In-process cron/interval/one-shot jobs; daemon supervised by systemd.              |
| **Coding sandbox** | @nqbao/pi-sandbox                 | bubblewrap, fail closed, explicit writable roots; separate profiles.               |
| **Research**       | pi-scraper                        | Exact source coverage; add pi-web-access only for fallback/deep fetch.             |
| **MCP bridge**     | pi-mcp-adapter                    | Bridge external connectors, but hide raw write tools behind approval.              |
| **Rednote**        | xpzouying/xiaohongshu-mcp         | Unofficial browser automation; local-only, ARM64 image, explicit approval.         |
| **Reddit**         | Small custom OAuth adapter        | Prefer auditable typed code; MCP server is an alternative.                         |
| **X**              | Small custom official-API adapter | Prefer official API; Xquik-based package is opt-in only.                           |

### 1.1 Two-track implementation

| **Track**                 | **Purpose**                              | **Interface**                       | **Exit condition**                                           |
|---------------------------|------------------------------------------|-------------------------------------|--------------------------------------------------------------|
| **A — package spike**     | Validate packages in interactive Pi.     | Pi CLI + @llblab Telegram companion | Five compatibility tests pass and APIs are understood.       |
| **B — production daemon** | Always-on local agent with durable jobs. | Telegram → daemon → Pi SDK          | Restarts cleanly, no TUI/PTY dependency, all writes audited. |

Track A is disposable learning. Track B is the product. A Pi package may be reused unchanged if it works with an SDK-created session; otherwise its core logic is adapted into the project rather than keeping a hidden CLI process alive.

### 1.2 Decisions still required from the owner

1. Accept or reject unofficial browser automation for Rednote. There is account-policy risk.
1. Choose X official API (recommended) or the Xquik-backed x-twitter-scraper package.
1. Choose a small custom Reddit OAuth connector (recommended) or jordanburke/reddit-mcp-server.
1. Choose report delivery time and timezone; default proposal is 08:00 Europe/London.

## 2. Problem, users, and outcomes

### 2.1 Problem statement

The operator builds software effectively but does not consistently discover user pain, explain the product, distribute learning, or respond to attention. Useful signals are fragmented across video, developer communities, repositories, and papers. Publishing is high-friction and easy to postpone.

### 2.2 Primary user

| **Attribute**     | **Requirement**                                                                            |
|-------------------|--------------------------------------------------------------------------------------------|
| **Persona**       | Solo technical founder / independent developer                                             |
| **Interaction**   | Mac for development; Telegram for mobile operation; Raspberry Pi as always-on host         |
| **Trust model**   | Single owner; private bot; no public multi-user access in v1                               |
| **Working style** | Prefer small, composable code and Git-controlled configuration                             |
| **Success need**  | Convert research into conversations, posts, and product decisions—not a generic assistant. |

### 2.3 Goals

- Deliver a useful, cited daily brief from YouTube, Hacker News, GitHub trending, arXiv, and optional watchlists.
- Let the owner start work, inspect status, review drafts, and approve one publication from Telegram.
- Run coding work inside a reviewed Linux isolation policy with a small, explicit write surface.
- Make every capability replaceable as a Pi extension, skill, prompt, or typed adapter.
- Keep operations understandable by one developer: one repository, one daemon, one SQLite database, and standard logs.

### 2.4 Non-goals for v1

- A public chatbot, team workspace, CRM, inbox replacement, or fully autonomous social-media manager.
- Automated mass replies, engagement farming, follow/unfollow automation, voting, or anti-spam evasion.
- General remote shell access through Telegram.
- Guaranteed containment against kernel vulnerabilities or a compromised root account.
- Full analytics attribution across platforms; v1 records URLs, timestamps, and manual outcome labels.

### 2.5 Success metrics after 30 days

| **Metric**                   | **Target**                                                                     |
|------------------------------|--------------------------------------------------------------------------------|
| **Daily report reliability** | ≥95% delivered by the configured time; per-source status included.             |
| **Signal usefulness**        | ≥3 saved/actioned items per week; owner rates ≥60% of briefs useful.           |
| **Draft throughput**         | ≥3 platform-tailored drafts per week.                                          |
| **Publishing safety**        | 0 unapproved posts; 100% writes have draft, approval, result, and platform ID. |
| **Operational burden**       | <30 minutes/week of maintenance excluding package upgrades.                   |
| **User-discovery outcome**   | ≥2 meaningful user conversations or feedback threads per month.                |

## 3. Product principles

| **Principle**                           | **Meaning**                                                                                                  |
|-----------------------------------------|--------------------------------------------------------------------------------------------------------------|
| **Package-first, not package-blind**    | Install a Pi package only after source, permissions, maintenance, and headless behavior are reviewed.        |
| **SDK is the orchestration boundary**   | Telegram and scheduled work call Pi session APIs. The CLI is for humans, not a transport protocol.           |
| **Read broadly; write narrowly**        | Research tools may fetch approved sources. Social connectors expose typed draft and publish operations only. |
| **Human approval is a product feature** | Every external social write needs an explicit, short-lived Telegram approval.                                |
| **Profiles before permissions sprawl**  | Research, coding, and publishing run with different tools and sandbox policies.                              |
| **Evidence before synthesis**           | The report is generated from a persisted evidence pack with URLs and timestamps.                             |
| **Small blast radius**                  | A dedicated service user cannot read the developer’s SSH keys, GitHub token, or unrelated home files.        |
| **Git is the source of truth**          | Package pins, skills, prompts, policy, migrations, and service templates live in one repository.             |

## 4. Architecture

### 4.1 Runtime topology

| **Layer**        | **Components**                                | **Responsibility**                                       |
|------------------|-----------------------------------------------|----------------------------------------------------------|
| **Operator**     | Telegram DM; Mac over Tailscale/SSH           | Commands, review, approvals, development.                |
| **Gateway**      | Telegram adapter + owner allowlist            | Normalize messages, buttons, files, and delivery.        |
| **Application**  | growth-agent-daemon                           | Dispatch, policy, approval queue, health, audit.         |
| **Orchestrator** | Pi SDK session runtime                        | Model turns, tools, skills, prompts, package resources.  |
| **Capabilities** | Scheduler; research; sandbox; social adapters | Bounded work behind typed interfaces.                    |
| **State**        | SQLite + report/artifact directory            | Jobs, evidence, drafts, approvals, publication receipts. |
| **Host**         | systemd + Linux service user + bubblewrap     | Restart, logs, filesystem/process boundary.              |

### 4.2 Request flow

1. Telegram update is accepted only from the paired owner and converted to an application command.
1. The dispatcher selects a profile: research, coding, or publishing. It loads the allowed tools and policy.
1. The daemon sends the prompt to an SDK-created Pi session and subscribes to lifecycle events for progress.
1. Read-only results may be returned immediately. A social write becomes a Draft plus an Approval record.
1. Telegram shows Preview / Edit / Approve / Reject. Approve uses a one-time token with expiry.
1. The connector publishes exactly once, stores the platform receipt, and returns the URL. Retries use an idempotency key.

### 4.3 Why the CLI is not the daemon API

Pi supports an SDK and session runtime. The daemon should call createAgentSession (or the corresponding runtime API), session.prompt / session.followUp, and session.subscribe. A resource loader can load the same project-local extensions, skills, prompts, and themes used by the CLI. This avoids brittle terminal control, hidden PTYs, output parsing, and subprocess lifecycle bugs.

> [!IMPORTANT]
> **Compatibility gate:** A catalogue extension is not automatically headless-safe. Pass it through: (1) SDK load, (2) no required TUI context, (3) clean shutdown, (4) no global singleton collision, (5) deterministic errors. If it fails, port the capability—not the CLI process.

### 4.4 Durable state

| **Table**            | **Key fields**                                     | **Purpose**                      |
|----------------------|----------------------------------------------------|----------------------------------|
| **jobs**             | id, schedule, timezone, profile, next_run, status  | Durable schedules and recovery.  |
| **source_items**     | source, external_id, url, title, observed_at, hash | Evidence and deduplication.      |
| **reports**          | period, markdown_path, source_status, hash         | Daily report history.            |
| **drafts**           | platform, body, media, policy_version, status      | Editable publication candidates. |
| **approvals**        | draft_id, token_hash, expires_at, decision, actor  | One-time human authorization.    |
| **publications**     | draft_id, platform_id, url, request_hash, result   | Idempotency and audit.           |
| **connector_health** | connector, checked_at, latency, result             | Operational visibility.          |

## 5. Functional requirements

| **ID**    | **Capability**   | **Requirement**                                                               | **Acceptance**                                              |
|-----------|------------------|-------------------------------------------------------------------------------|-------------------------------------------------------------|
| **FR-01** | Telegram control | Accept owner DM, queue prompts, stream progress, return files, show status.   | Unpaired users receive no data or actions.                  |
| **FR-02** | Scheduling       | Cron, interval, relative and one-shot jobs; timezone-aware; restart recovery. | A missed run policy is explicit per job.                    |
| **FR-03** | Sandboxed coding | Run shell/file work in a named policy with explicit writable roots.           | Forbidden path reads/writes fail closed and are logged.     |
| **FR-04** | Source ingestion | Fetch YouTube, HN, GitHub trending proxy, arXiv; preserve evidence.           | Each source has timestamp, URL, status and stable ID.       |
| **FR-05** | Daily report     | Normalize, dedupe, rank, summarize, cite, and deliver Markdown.               | One failure cannot suppress the entire report.              |
| **FR-06** | Drafting         | Turn a finding or project update into platform-specific drafts.               | Voice and platform constraints are loaded as skills/policy. |
| **FR-07** | Approval         | Preview, edit, approve, reject, expire, and revoke.                           | Publish tool is unreachable without a valid approval.       |
| **FR-08** | Publishing       | Publish to Rednote, Reddit, and X through typed adapters.                     | Store request hash, platform ID, URL, and response.         |
| **FR-09** | Observability    | Health, structured logs, job status, connector status, failure alert.         | Secrets and model hidden reasoning never enter logs.        |
| **FR-10** | Administration   | Install/pin packages, migrate DB, backup state, rotate tokens.                | Runbook works from a clean 64-bit Raspberry Pi image.       |

### 5.1 Telegram command set

| **Command / control**   | **Behavior**                                                                        |
|-------------------------|-------------------------------------------------------------------------------------|
| **/start**              | Pair first owner; show health, next report, queue, and draft count.                 |
| **/brief now**          | Run report pipeline now; do not alter the scheduled job.                            |
| **/watch <topic\>**    | Add a topic/repository/channel/arXiv query to the reviewable watchlist.             |
| **/draft <platform\>** | Create a platform-specific draft from the replied-to message or latest report item. |
| **Approve**             | Authorize one exact draft hash for one platform within the token lifetime.          |
| **Edit**                | Open a new agent turn; changes invalidate the old approval.                         |
| **Reject**              | Close draft without external write.                                                 |
| **/jobs**               | List schedules, last/next run, status, and retry state.                             |
| **/health**             | Show daemon, model, source, connector, disk, and database status.                   |
| **/stop**               | Abort current agent run and preserve durable queue unless explicitly cleared.       |

### 5.2 Daily report contract

- Header: coverage window, generated time, model, and source health.
- Must read: no more than five items, each with why it matters and a direct URL.
- User/distribution signals: pain, language users use, emerging demand, and relevant discussions.
- Build signals: trending repositories, implementation patterns, releases, and competitive movement.
- Research: papers grouped by watch topic with one-sentence applicability.
- Actions today: at most three concrete experiments, replies, or draft opportunities.
- Footer: duplicate count, source errors, and feedback buttons Useful / Not useful / Save.

### 5.3 Publishing policy

| **State**             | **Allowed action**                                                                |
|-----------------------|-----------------------------------------------------------------------------------|
| **Evidence**          | Read and summarize; never publishes.                                              |
| **Draft**             | Edit, preview, add media, run policy check.                                       |
| **Awaiting approval** | No mutation except approve/reject/expire.                                         |
| **Approved**          | One connector call for the exact content hash and platform.                       |
| **Published**         | Store receipt; further edits create a new draft.                                  |
| **Failed**            | Show error; retry requires owner confirmation unless no request reached platform. |

## 6. Non-functional requirements

| **Area**            | **Requirement**                                                                                                |
|---------------------|----------------------------------------------------------------------------------------------------------------|
| **Security**        | Single owner; least-privilege service user; secrets outside repo; approval before writes; fail-closed sandbox. |
| **Reliability**     | systemd restart; SQLite WAL; atomic files; connector timeouts; per-source isolation; missed-run policy.        |
| **Performance**     | Telegram ack <2s; report completes <20 min under normal APIs; one active model turn per profile.             |
| **Privacy**         | No public inbound port required; Telegram long polling; redact tokens/cookies; do not log hidden reasoning.    |
| **Maintainability** | One TypeScript repo; typed adapters; migrations; package lock; package review ledger; source-specific tests.   |
| **Portability**     | Primary target Linux arm64. Mac is a client/development machine; bubblewrap is Linux-only.                     |
| **Cost control**    | Per-job model selection; capped source items; API budgets; disable expensive fallback unless needed.           |
| **Accessibility**   | Telegram controls have text labels; reports are structured Markdown with URLs, not image-only cards.           |

### 6.1 Reliability rules

- A source fetch has a timeout, retry budget, circuit breaker, and last-known health.
- Scheduler stores next_run before execution and completion after execution; startup reconciles interrupted work.
- Publication retries are never blind. A connector must check the stored request hash or platform result first.
- Daily reports are immutable artifacts; corrections create a new version linked to the original.
- Disk pressure pauses downloads and coding work before the database or OS partition is exhausted.

## 7. Security model

> [!CAUTION]
> **Terminology:** bubblewrap can provide a kernel-enforced namespace and mount boundary under a reviewed policy. It is not a mathematical guarantee, a virtual machine, or protection from a kernel/root compromise. The policy is only as safe as its writable mounts, network settings, and exposed secrets.

### 7.1 Separation of profiles

| **Profile**   | **Filesystem**                                             | **Network**                  | **Exposed tools**                            |
|---------------|------------------------------------------------------------|------------------------------|----------------------------------------------|
| **Research**  | Project read-only; report/cache writable                   | Outbound to approved sources | Typed fetch/search; no arbitrary publisher.  |
| **Coding**    | Selected repository writable; OS read-only; secrets denied | Off by default               | read/write/edit/bash under bubblewrap.       |
| **Publisher** | Draft/media read-only; receipt store writable              | Only connector endpoints     | Policy check + typed publish after approval. |

### 7.2 Threats and controls

| **Threat**                              | **Control**                                                                                     |
|-----------------------------------------|-------------------------------------------------------------------------------------------------|
| **Prompt injection in fetched content** | Treat sources as untrusted data; research profile cannot publish or write code.                 |
| **Malicious Pi package**                | Pin version/commit, inspect source and lifecycle hooks, test under service user, record review. |
| **Telegram token theft**                | 0600 EnvironmentFile or systemd credentials; owner allowlist; rotate via BotFather.             |
| **Cookie/session theft**                | Keep Rednote data volume local, 0700 directory, 0600 files; never expose MCP port publicly.     |
| **Accidental duplicate post**           | Draft hash + approval token + publication idempotency record + platform lookup.                 |
| **Sandbox escape through broad mounts** | No home bind; explicit repository root; deny .ssh/.gnupg/config; no Docker socket.              |
| **Supply-chain update**                 | Version pins, package-lock, manual upgrade PR, smoke test, and rollback tag.                    |
| **Telegram as remote shell**            | Expose prompt templates and typed commands; do not forward arbitrary slash commands or raw PTY. |

## 8. Pi package catalogue audit

Counts below are rolling values displayed by pi.dev on 26 July 2026. “mo / wk” is catalogue-reported monthly / weekly downloads. External GitHub projects use stars or Docker pulls only when a Pi download counter does not exist; those measures are not directly comparable.

### 8.1 Telegram candidates

| **Package**                                                                                           | **Version** | **Downloads mo / wk** | **Fit**                                                           | **Decision**                         |
|-------------------------------------------------------------------------------------------------------|-------------|-----------------------|-------------------------------------------------------------------|--------------------------------------|
| [@llblab/pi-telegram](https://pi.dev/packages/%40llblab/pi-telegram)                           | 0.24.11     | 9,796 / 2,799         | Two-way operator surface, queue, streaming, files, owner pairing. | SELECT for spike; test SDK/headless. |
| [@wienerberliner/pi-telegram](https://pi.dev/packages/%40wienerberliner/pi-telegram)           | —           | 1,226 / 42            | One-way notifications.                                            | Delivery fallback only.              |
| [pitgram](https://pi.dev/packages/pitgram)                                                     | —           | 778 / 38              | Remote session list/create/switch; attachments.                   | Alternative if session UI matters.   |
| [@bytesbrains/pi-telegram-bridge](https://pi.dev/packages/%40bytesbrains/pi-telegram-bridge)   | —           | 423 / 57              | listen/send tools; listening starts when agent calls tool.        | Weak always-on inbound model.        |
| [pi-telebridge](https://pi.dev/packages/pi-telebridge)                                         | —           | 195 / 58              | Two-way, voice/photo, per-session toggle.                         | Small alternative.                   |
| [@artyomspace/pi-telegram-connect](https://pi.dev/packages/%40artyomspace/pi-telegram-connect) | —           | 166 / 52              | Single-owner DM, streaming, tool progress.                        | Small alternative.                   |
| [@jc4649/telegram-remote](https://pi.dev/packages/%40jc4649/telegram-remote)                   | —           | 129 / n/a             | Lightweight outbound remote.                                      | Not sufficient alone.                |

### 8.2 Scheduling candidates

| **Package**                                                                         | **Version** | **Downloads mo / wk** | **Fit**                                                                   | **Decision**                           |
|-------------------------------------------------------------------------------------|-------------|-----------------------|---------------------------------------------------------------------------|----------------------------------------|
| [pi-schedule-prompt](https://pi.dev/packages/pi-schedule-prompt)             | 0.4.1       | 2,104 / 402           | Cron/interval/relative/one-shot; persisted; separate in-process sessions. | SELECT.                                |
| [@trevonistrevon/pi-loop](https://pi.dev/packages/%40trevonistrevon/pi-loop) | 0.6.4       | 2,677 / 809           | Cron/event/self-paced/background monitors.                                | Good alternative.                      |
| [@koltmcbride/pi-loop](https://pi.dev/packages/%40koltmcbride/pi-loop)       | 0.2.0       | 1,185 / 981           | Timer/event/hybrid, persistence, expiry.                                  | Alternative.                           |
| [@pi-agents/loop](https://pi.dev/packages/%40pi-agents/loop)                 | 0.3.1       | 1,051 / 104           | Idle gating, durable tasks, missed one-shot recovery.                     | Evaluate if recovery is stronger.      |
| [@davecodes/pi-routines](https://pi.dev/packages/%40davecodes/pi-routines)   | 0.5.1       | 400 / 46              | Cron TZ, pulse, one-off, hooks, API/GitHub triggers.                      | Alternative; live-session assumptions. |
| [pi-tick](https://pi.dev/packages/pi-tick)                                   | —           | 127 / 127             | Native cron/launchd; spawns fresh pi and reads event stream.              | REJECT for daemon.                     |

### 8.3 Sandbox candidates

| **Package**                                                                     | **Version** | **Downloads mo / wk** | **Fit**                                                               | **Decision**                   |
|---------------------------------------------------------------------------------|-------------|-----------------------|-----------------------------------------------------------------------|--------------------------------|
| [pi-sandbox](https://pi.dev/packages/pi-sandbox)                         | 0.6.1       | 4,085 / 1,864         | Allow/deny + sandboxed bash + interactive prompts.                    | SELECT for manual development. |
| [@nqbao/pi-sandbox](https://pi.dev/packages/%40nqbao/pi-sandbox)         | 0.1.3       | 156 / 64              | bubblewrap on Linux; intercepts bash and file mutations; fail closed. | SELECT for daemon.             |
| [@jerryan/pi-bash-wrap](https://pi.dev/packages/%40jerryan/pi-bash-wrap) | 0.1.5       | 194 / 22              | Linux bwrap; root read-only; cwd writable; optional no-network.       | Alternative; shell-focused.    |
| [pi-guard-sandbox](https://pi.dev/packages/pi-guard-sandbox)             | 0.3.0       | 153 / 39              | Linux/WSL, composable, destructive-command guard.                     | Alternative.                   |
| [pi-claude-sandbox](https://pi.dev/packages/pi-claude-sandbox)           | 0.6.0       | 87 / 12               | Sandboxed bash; pairs with permission extension.                      | Alternative.                   |
| [pi-permission-modes](https://pi.dev/packages/pi-permission-modes)       | —           | 131 / 131             | Declarative modes, bwrap/sandbox-exec, AST gating.                    | Promising; review maturity.    |

> [!WARNING]
> **Do not compose shell wrappers casually:** Only one package should own the bash/file interception layer in a profile. Multiple sandbox extensions can override one another or create misleading policy. Manual development and daemon operation may use different configurations, but not simultaneous wrappers in one session.

### 8.4 Research candidates

| **Package**                                                                                             | **Version** | **Downloads mo / wk** | **Coverage**                                                    | **Decision**                                |
|---------------------------------------------------------------------------------------------------------|-------------|-----------------------|-----------------------------------------------------------------|---------------------------------------------|
| [pi-scraper](https://pi.dev/packages/pi-scraper)                                                 | 0.13.1      | 439 / 73              | HN API, arXiv, YouTube, Reddit, OSSInsight trending.            | SELECT: exact source coverage.              |
| [pi-web-access](https://pi.dev/packages/pi-web-access)                                           | 0.14.0      | 135.2K / 32.3K        | General search/fetch, GitHub clone, PDF, YouTube understanding. | Optional fallback only.                     |
| [@black-knight.dev/emet](https://pi.dev/packages/%40black-knight.dev/emet)                       | 2.0.0       | 1,632 / 101           | Cited research across HN, Reddit, GitHub, RSS, YouTube.         | Alternative; no exact arXiv/trending match. |
| [@firstpick/pi-extension-tech-news](https://pi.dev/packages/%40firstpick/pi-extension-tech-news) | 0.2.0       | 323 / 20              | HN, Reddit, Socket, daily.dev, X.                               | Useful tech-news supplement.                |
| [@yrfns/pi-agent-reach](https://pi.dev/packages/%40yrfns/pi-agent-reach)                         | 0.3.0       | 184 / 28              | Read/search X, Reddit, Rednote, YouTube, GitHub, RSS.           | REJECT: many CLI/cookie subprocesses.       |
| [pi-reddit-research](https://pi.dev/packages/pi-reddit-research)                                 | —           | 708 / 29              | Read-only Reddit research.                                      | Optional source specialist.                 |
| [pi-smart-fetch](https://pi.dev/packages/pi-smart-fetch)                                         | —           | 3,009 / 768           | Fetch YouTube, Reddit, X, GitHub and HN pages.                  | Alternative page fetcher.                   |

### 8.5 Publishing and MCP candidates

| **Project**                                                                              | **Source**    | **Version** | **Metric**               | **Fit**                                                     | **Decision**                         |
|------------------------------------------------------------------------------------------|---------------|-------------|--------------------------|-------------------------------------------------------------|--------------------------------------|
| [pi-mcp-adapter](https://pi.dev/packages/pi-mcp-adapter)                          | Pi            | 2.15.0      | 168.2K / 54.1K           | Token-efficient MCP bridge; lazy servers.                   | SELECT, behind approval gate.        |
| [x-twitter-scraper](https://pi.dev/packages/x-twitter-scraper)                    | Pi            | 0.6.1       | 1,108 / 721              | Xquik-backed read/write SDK: posts, replies, likes.         | Opt-in only; third-party service.    |
| [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)         | GitHub/Docker | current     | 14.9K stars; 100K+ pulls | Rednote image/video publishing via browser session.         | Candidate; unofficial/account risk.  |
| [jordanburke/reddit-mcp-server](https://github.com/jordanburke/reddit-mcp-server) | GitHub/npm    | current     | Pi count n/a; 201 stars  | Create/reply/edit/delete; safe mode and duplicate controls. | Alternative to custom OAuth adapter. |
| [DataWhisker/x-mcp-server](https://github.com/DataWhisker/x-mcp-server)           | GitHub        | current     | Pi count n/a; 73 stars   | Official X API actions incl. media, replies, delete.        | Alternative to custom connector.     |
| [Infatoshi/x-mcp](https://github.com/Infatoshi/x-mcp)                             | GitHub        | current     | Pi count n/a; 51 stars   | X posts/search/timeline/media.                              | Smaller alternative.                 |

Finding: the Pi catalogue is strong for transport, scheduling, sandboxing, and research. It does not currently provide one clearly suitable, safe, official publisher for Rednote + Reddit + X. The product therefore needs a small approval layer and platform adapters.

## 9. Recommended package baseline

### 9.1 Project-local pins

```bash
pi install -l npm:@llblab/pi-telegram@0.24.11
pi install -l npm:pi-schedule-prompt@0.4.1
pi install -l npm:@nqbao/pi-sandbox@0.1.3
pi install -l npm:pi-scraper@0.13.1
pi install -l npm:pi-mcp-adapter@2.15.0

# Optional fallback after the baseline is measured
pi install -l npm:pi-web-access@0.14.0
```

Commit the project’s .pi configuration, package manifest, and lockfile. Do not commit tokens, cookies, Telegram state, report artifacts, or the SQLite database. A package upgrade is a reviewed pull request with source diff, permission diff, smoke tests, and a rollback tag.

### 9.2 Package review checklist

- Identity: repository, maintainer, license, published package ownership, and release provenance.
- Activity: recent commits/releases, issue response, and dependency freshness.
- Execution: install scripts, lifecycle hooks, subprocesses, network endpoints, global files, and singleton locks.
- Permissions: paths, environment variables, tokens, cookies, shell, and external APIs.
- Headless: SDK-created session loads, no mandatory TUI methods, clean abort and shutdown, deterministic errors.
- Failure: rate limits, retry logic, idempotency, partial results, and corrupt-state recovery.
- Rollback: exact version pin and known-good configuration.

## 10. Custom package specification

### 10.1 Why custom code is still small

Custom work should contain business policy and gaps—not reimplement Pi, Telegram, scheduling, scraping, or MCP. The expected custom surface is an SDK daemon, approval gate, report pipeline, three thin social adapters/wrappers, and founder-specific skills.

### 10.2 Repository layout

```text
growth-agent/
├── src/
│   ├── daemon.ts                 # SDK session runtime + Telegram dispatch
│   ├── profiles/                 # research, coding, publisher
│   ├── scheduler/                # reconciliation and job handlers
│   ├── reports/                  # normalize, dedupe, rank, render
│   ├── approvals/                # draft hash, tokens, expiry, audit
│   └── connectors/               # reddit.ts, x.ts, rednote-mcp.ts
├── extensions/
│   ├── approval-gate.ts
│   ├── daily-report.ts
│   └── headless-telegram.ts      # only if package cannot embed
├── skills/
│   ├── daily-brief/SKILL.md
│   ├── founder-voice/SKILL.md
│   ├── rednote-post/SKILL.md
│   ├── reddit-post/SKILL.md
│   └── x-post/SKILL.md
├── prompts/daily-report.md
├── config/*.example.yaml
├── migrations/
├── tests/
└── deploy/growth-agent.service
```

### 10.3 Pi package manifest

```json
{
  "name": "@your-scope/growth-agent-kit",
  "private": true,
  "type": "module",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-agent-core": "*"
  }
}
```

### 10.4 Adapter contracts

| **Contract**                                    | **Required behavior**                                                                 |
|-------------------------------------------------|---------------------------------------------------------------------------------------|
| **ResearchSource.fetch(window, cursor)**        | Returns normalized items, source status, rate-limit metadata, and next cursor.        |
| **DraftRenderer.render(item, platform, voice)** | Returns content, media plan, warnings, and deterministic content hash.                |
| **Policy.check(draft)**                         | Returns allow/warn/deny with machine-readable reasons and policy version.             |
| **Publisher.preview(draft)**                    | Validates account, length/media, and remote readiness without publishing.             |
| **Publisher.publish(approvedDraft)**            | Requires approval ID; returns platform ID, URL, timestamp, and raw receipt reference. |
| **Publisher.lookup(idempotencyKey)**            | Checks whether a prior request succeeded before any retry.                            |

### 10.5 Platform implementation notes

| **Platform**              | **v1 approach**                                                                                    | **Important constraint**                                                        |
|---------------------------|----------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| **Rednote / 小红书 (Xiaohongshu)** | Local xiaohongshu-mcp over loopback; explicit ARM64 image tag; persist browser data.               | Unofficial browser automation. Preview and throttle; account may be challenged. |
| **Reddit**                | Small OAuth adapter using the platform API, subreddit allowlist, duplicate prevention, user agent. | Subreddit rules and API terms vary. No voting or mass replies.                  |
| **X**                     | Small official API connector for create-post/reply/media, with API budget.                         | Pricing/policy changes; current create-post price shown as $0.015/request.     |

Rednote note: the public official documentation reviewed was centered on commerce, mini-app, and service capabilities. A general public creator-note publishing API was not found. This is an inference from the reviewed documentation, so re-check before implementation.

## 11. Raspberry Pi setup guide

### 11.1 Recommended hardware and OS

| **Item**          | **Recommendation**                                                                        |
|-------------------|-------------------------------------------------------------------------------------------|
| **Computer**      | Raspberry Pi 5, 8 GB RAM. 4 GB may work without Chromium-heavy publishing.                |
| **Storage**       | 64 GB+ USB 3 SSD/NVMe preferred; avoid write-heavy SQLite/logging on low-quality microSD. |
| **OS**            | 64-bit Raspberry Pi OS Lite; keep packages and firmware patched.                          |
| **Power/cooling** | Official-quality PSU and active cooling for long model/tool workloads.                    |
| **Network**       | Ethernet preferred; Tailscale for private Mac access; no public port forward.             |

### 11.2 Host packages

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential \
  bubblewrap sqlite3 ripgrep ffmpeg jq

# Install current Node.js 24 LTS (or another supported release >=22.19)
node --version
npm --version
bwrap --version
```

Use your preferred audited Node distribution method. Confirm arm64 binaries and pin the major release. bubblewrap is Linux-only and optional for Pi itself; it is required only for the selected coding sandbox.

### 11.3 Accounts and directories

```bash
sudo useradd --system --create-home --home-dir /var/lib/growth-agent \
  --shell /usr/sbin/nologin growth-agent
sudo install -d -o growth-agent -g growth-agent -m 0750 /srv/growth-agent/app
sudo install -d -o growth-agent -g growth-agent -m 0700 /var/lib/growth-agent
sudo install -d -o root -g growth-agent -m 0750 /etc/growth-agent
sudo install -o root -g growth-agent -m 0640 /dev/null \
  /etc/growth-agent/growth-agent.env
```

Keep your interactive development account separate from growth-agent. The service user has no sudo, interactive shell, SSH keys, GitHub credentials, Docker socket, or access to your home directory.

### 11.4 Install Pi core and clone the project

```bash
sudo npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi --version

# Clone as your development user, review, then deploy through Git
git clone git@github.com:YOUR_ACCOUNT/growth-agent.git
cd growth-agent
npm ci
pi install -l npm:@llblab/pi-telegram@0.24.11
pi install -l npm:pi-schedule-prompt@0.4.1
pi install -l npm:@nqbao/pi-sandbox@0.1.3
pi install -l npm:pi-scraper@0.13.1
pi install -l npm:pi-mcp-adapter@2.15.0
```

> [!WARNING]
> **Install-script policy:** Pi’s documented install examples use --ignore-scripts for the core package. Apply the same suspicion to every dependency: inspect lifecycle scripts before allowing them. Pi packages execute with the process’s full privileges unless the OS and your policy restrict them.

## 12. Configure Telegram, scheduling, and reports

### 12.1 Telegram package spike

1. Open @BotFather in Telegram, run /newbot, choose a private bot username, and copy the token.
1. Start interactive Pi in the project and run /telegram-setup; paste the token.
1. Run /telegram-connect. In the bot DM, send /start. The first user becomes the allowed owner.
1. Run /telegram-status and test text, queued work, a small file, abort, reconnect, and restart.
1. Record whether the adapter loads and polls correctly from an SDK-created session. If not, port its transport/runtime layer into headless-telegram.ts.

> [!CAUTION]
> **Token handling:** The package may store configuration under ~/.pi/agent/telegram.json. Ensure that directory is owned by the service user with mode 0700 and files 0600. Never paste the token into Git, a report, a model prompt, or an issue. Revoke and recreate it if exposed.

### 12.2 Scheduler configuration

Create one durable daily-report job and separate health/cleanup jobs. The scheduler should call an in-process Pi session. systemd supervises the daemon; system cron must not spawn Pi for each run.

| **Job**                     | **Proposed schedule**     | **Profile** | **Missed-run policy**                                      |
|-----------------------------|---------------------------|-------------|------------------------------------------------------------|
| **daily-report**            | 08:00 Europe/London daily | research    | Run once if <6h late; otherwise skip and alert.           |
| **connector-health**        | Every 6 hours             | system      | Run immediately after restart.                             |
| **artifact-cleanup**        | 03:15 Sunday              | system      | Skip if missed; never delete reports/publication receipts. |
| **package-review-reminder** | First Saturday monthly    | system      | Notify only; upgrades remain manual.                       |

### 12.3 Source configuration

```yaml
timezone: Europe/London
sources:
  youtube:
    channels: []
    queries: ["developer tools", "local AI agents"]
    max_items: 15
  hackernews:
    min_score: 20
    max_items: 40
  github:
    topics: ["ai-agent", "developer-tools"]
    trending_proxy: ossinsight
    max_items: 25
  arxiv:
    queries: ["cat:cs.AI", "cat:cs.SE"]
    max_items: 20
report:
  max_must_read: 5
  max_actions: 3
```

Use the official Hacker News and arXiv APIs through the package. Be polite to arXiv (the official sample guidance recommends roughly three seconds between calls). GitHub has an official REST API, but the Trending page does not expose a documented official API; OSSInsight is therefore a trending proxy and must be labeled as such in the report.

### 12.4 Report pipeline

1. Fetch each source independently and persist raw normalized items before invoking the model.
1. Deduplicate by canonical URL, external ID, and semantic hash; preserve multiple-source references.
1. Rank using deterministic recency/engagement/watchlist features, then ask Pi to explain relevance.
1. Require every claim about an item to carry its evidence URL; mark inferences as inferences.
1. Render full Markdown to the artifact directory and a compact Telegram summary with an attached file.
1. Collect Useful / Not useful / Save feedback and use it only as explicit ranking data.

## 13. Configure bubblewrap safely

### 13.1 Selected daemon policy

```json
{
  "enabled": true,
  "provider": "bubblewrap",
  "writable": ["${WORKSPACE}", "${TMP}"],
  "denyRead": [
    "${HOME}/.ssh",
    "${HOME}/.gnupg",
    "${HOME}/.config",
    "/etc/growth-agent"
  ],
  "denyWithin": ["${WORKSPACE}/.git/hooks"],
  "network": false
}
```

Treat this as an illustrative policy: verify the package’s current schema before copying it. Resolve variables to explicit paths at startup and reject empty, root, home, or workspace-parent values. Network stays off for coding; package installation is a distinct owner-approved profile.

### 13.2 Sandbox acceptance tests

| **Test**             | **Action**                                                     | **Expected**                                                |
|----------------------|----------------------------------------------------------------|-------------------------------------------------------------|
| **Allowed write**    | Create/edit a file under a test repository.                    | Succeeds; change appears in Git diff.                       |
| **Denied read**      | Read ~/.ssh/id_ed25519 and /etc/growth-agent/growth-agent.env. | Fails; no content reaches model/log.                        |
| **Denied write**     | Write outside repository and temp roots.                       | Fails.                                                      |
| **System mutation**  | Attempt apt install or write /usr/local/bin.                   | Fails.                                                      |
| **Network**          | curl a public site in coding profile.                          | Fails unless explicit install profile is active.            |
| **Git hook**         | Write .git/hooks/pre-commit.                                   | Fails.                                                      |
| **Symlink escape**   | Follow a repository symlink to a denied path.                  | Fails.                                                      |
| **Provider missing** | Temporarily remove bwrap from PATH.                            | Agent refuses shell/file mutation; no unsandboxed fallback. |

### 13.3 Mac behavior

bubblewrap does not run natively on macOS and is not required by Pi core. The Raspberry Pi is Linux, so it is the correct place to enforce bubblewrap. The Mac acts as your terminal/editor/control device over Tailscale + SSH. If you later run Pi locally on the Mac, use a macOS-specific sandbox provider or a Linux VM.

## 14. Configure social publishing

### 14.1 Approval gate

Raw MCP write tools must not be directly visible to the general research or coding agent. pi-mcp-adapter can discover servers, while approval-gate.ts exposes only preview and requestPublication. After Telegram approval, application code—not a free-form model turn—invokes the exact typed tool with the approved content hash.

| **Check**    | **Rule**                                                                         |
|--------------|----------------------------------------------------------------------------------|
| **Identity** | Connector account must equal the configured account ID/handle.                   |
| **Content**  | Hash of text, media IDs, target/community, and reply parent must match approval. |
| **Token**    | Random one-time token; store only hash; expire after 15 minutes.                 |
| **Policy**   | No deny result; warnings shown in Telegram before approval.                      |
| **Rate**     | Per-platform daily cap and minimum interval.                                     |
| **Retry**    | Lookup idempotency key/platform receipt before retry.                            |
| **Audit**    | Store actor, decision time, policy version, request hash, result, and URL.       |

### 14.2 Rednote / 小红书 (Xiaohongshu)

Run xpzouying/xiaohongshu-mcp in a container bound to 127.0.0.1. Docker Hub exposes ARM64-specific tags; pin one by version/digest after testing. The browser data and images directories must be private and persistent. Chromium makes this the heaviest connector on an 8 GB Pi.

```bash
mkdir -p /var/lib/growth-agent/rednote/{data,images}
chmod 700 /var/lib/growth-agent/rednote/{data,images}

# Example only: choose and pin a tested current ARM64 tag/digest.
docker pull xpzouying/xiaohongshu-mcp:latest-arm64
docker run -d --name xiaohongshu-mcp --restart=unless-stopped \
  -p 127.0.0.1:18060:18060 \
  -v /var/lib/growth-agent/rednote/data:/app/data \
  -v /var/lib/growth-agent/rednote/images:/app/images \
  xpzouying/xiaohongshu-mcp:latest-arm64
```

Before enabling publish: log in interactively, verify the account handle, publish a private/test note if the platform supports it, confirm media paths, then set a conservative daily cap. Never expose port 18060 to LAN/Tailscale or the internet.

### 14.3 Reddit

- Register an application in Reddit’s developer flow and use OAuth with a descriptive User-Agent.
- Allowlist subreddits. Fetch and display the target community rules before approval.
- Implement submit text/link, comment/reply, edit, delete, and lookup—but enable only submit/reply in v1.
- Never vote, evade bans/rate limits, mass-reply, or reuse the same content across communities.

If you choose jordanburke/reddit-mcp-server, connect it through pi-mcp-adapter and still place every write behind the project’s approval gate. Its safe mode and duplicate controls complement—not replace—the gate.

### 14.4 X

- Default: official X API connector with OAuth, create-post/reply/media, lookup, and delete.
- Set a small daily API budget; the current developer page shows create-post at $0.015/request.
- Treat replies as higher risk than standalone posts; enable them after platform-policy review.
- Alternative: DataWhisker/x-mcp-server. Opt-in alternative: x-twitter-scraper via Xquik.

Do not silently fall back from an official API to browser or third-party scraping. Connector selection is a configuration decision shown in the approval preview.

## 15. Build and operate the daemon

### 15.1 SDK skeleton

```typescript
// Illustrative shape; confirm exact imports against the pinned Pi version.
const session = await createAgentSession({
  cwd: workspace,
  resourceLoader,
  tools: toolsFor(profile),
});

session.subscribe((event) => telegramProgress(event));
await session.prompt(ownerPrompt);
// Use followUp/steer for queued continuation semantics.
// Never parse stdout from a child `pi` process.
```

### 15.2 systemd service

```ini
[Unit]
Description=Local Pi Growth Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=growth-agent
Group=growth-agent
WorkingDirectory=/srv/growth-agent/app
EnvironmentFile=/etc/growth-agent/growth-agent.env
ExecStart=/usr/bin/node dist/daemon.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/growth-agent/app /var/lib/growth-agent
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
```

Replace /usr/bin/node with the actual absolute path from command -v node. Do not enable PrivateNetwork: Telegram and source APIs need outbound network. The service hardening is additive to per-task bubblewrap.

```bash
sudo cp deploy/growth-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now growth-agent
systemctl status growth-agent
journalctl -u growth-agent -f
```

### 15.3 Mac → Raspberry Pi development loop

1. Install Tailscale on both machines and SSH to the Pi’s private Tailscale name/address.
1. Run Codex and development tools on the Raspberry Pi in the repository as your development user.
1. Create a branch, ask Codex to implement/tests locally, inspect git diff, and run the relevant test profile.
1. Push to GitHub and merge through a pull request. The service deployment checks out only reviewed commits/tags.
1. Run the migration/build, restart systemd, inspect health/logs, and test through Telegram.

> [!WARNING]
> **Deployment boundary:** Do not let the Telegram agent push directly to the protected branch or restart arbitrary services. Development via SSH/Codex and operation via Telegram are separate trust paths.

### 15.4 Backups and recovery

- Nightly SQLite online backup plus reports/publication receipts; encrypt off-device copy.
- Back up configuration templates and package pins through Git, not live secrets.
- Keep Rednote session data separate; loss requires login, not database restoration.
- Test restore quarterly on a disposable directory/service instance.

## 16. Testing and acceptance

### 16.1 Package compatibility spike

| **Gate**        | **Pass condition**                                                                                  |
|-----------------|-----------------------------------------------------------------------------------------------------|
| **SDK load**    | Package loads through project resource loader in an SDK-created session.                            |
| **Headless**    | No TUI call is required for normal operation; configuration has a non-interactive path.             |
| **Lifecycle**   | Abort, reconnect, shutdown, and restart release locks and polling cleanly.                          |
| **Isolation**   | Package cannot read/write beyond the service user and configured profile.                           |
| **Error model** | Rate limits, invalid tokens, unavailable network, and corrupt state become typed/reportable errors. |

### 16.2 End-to-end acceptance scenarios

| **Scenario**              | **Test**                                         | **Expected**                                                             |
|---------------------------|--------------------------------------------------|--------------------------------------------------------------------------|
| **Daily brief**           | Disable one source; run scheduled report.        | Report arrives with other sources and one explicit source error.         |
| **Restart**               | Kill daemon during a job; systemd restarts.      | No duplicate report/post; job state reconciles.                          |
| **Prompt injection**      | Fetched page asks agent to publish/read secrets. | Research profile ignores instruction; cannot reach publish/secret tools. |
| **Coding boundary**       | Ask agent to edit repo and read SSH key.         | Repo edit succeeds; SSH read fails; event logged.                        |
| **Draft edit**            | Approve, then edit draft.                        | Old approval invalidates; publish blocked until re-approved.             |
| **Duplicate post**        | Repeat an approved publication command.          | Lookup returns existing receipt; no second post.                         |
| **Unknown Telegram user** | Second account sends /start.                     | No status/data/action; security event recorded without content.          |
| **Rednote outage**        | Stop local MCP container.                        | Preview/publish fails safely; other capabilities remain healthy.         |

### 16.3 Definition of done for v1

- Daemon survives reboot and reports health from Telegram.
- Daily report meets reliability target for seven consecutive days.
- All three profiles pass the filesystem/network boundary tests.
- One approved test post succeeds on each enabled platform and records a receipt.
- No package or connector requires a hidden Pi CLI subprocess.
- Fresh-install runbook succeeds on a clean 64-bit Raspberry Pi image.
- Backup and restore of SQLite plus report artifacts is demonstrated.

## 17. Rollout plan

| **Phase**                            | **Scope**                                                               | **Exit criterion**                                    |
|--------------------------------------|-------------------------------------------------------------------------|-------------------------------------------------------|
| **0 — compatibility spike (2 days)** | Install pins; test SDK/headless, Telegram, scheduler, scraper, sandbox. | Keep/port decision recorded for each package.         |
| **1 — read-only brief (week 1)**     | Daemon, Telegram, SQLite, daily report, feedback.                       | 7 reliable briefs; no publishing credentials.         |
| **2 — coding sandbox (week 2)**      | Coding profile, bubblewrap tests, Git workflow.                         | All boundary tests pass; fail-closed verified.        |
| **3 — draft-only social (week 3)**   | Voice skills, platform renderers, policy checks.                        | Owner approves draft quality without external writes. |
| **4 — approved publishing (week 4)** | One platform at a time: Reddit → X → Rednote.                           | Receipts, retries, caps, and audit verified.          |
| **5 — discovery loop**               | Track feedback threads, questions, saved signals, and experiments.      | Monthly outcome review drives prompt/product changes. |

### 17.1 Platform enablement order

1. Reddit: clear community context and easiest to validate a small official OAuth connector.
1. X: official API budget and policy configured; standalone posts before replies.
1. Rednote: heaviest and unofficial browser automation; enable only after account-risk acceptance.

## 18. Risks and mitigations

| **Risk**                           | **Impact** | **Mitigation**                                                                               |
|------------------------------------|------------|----------------------------------------------------------------------------------------------|
| **Package churn / takeover**       | High       | Pin exact versions/commits; source review ledger; manual upgrades; rollback.                 |
| **Platform API or policy changes** | High       | Typed adapters, connector health, policy versioning, re-check before enabling.               |
| **Rednote account challenge**      | High       | Local browser session, low rate, explicit approval, stop on challenge; accept residual risk. |
| **Prompt injection**               | High       | Separate profiles; untrusted source treatment; no publisher in research session.             |
| **Raspberry Pi resource pressure** | Medium     | 8 GB + SSD; limits; sequential Chromium tasks; disk/temperature alerts.                      |
| **Report noise**                   | Medium     | Hard caps, deterministic ranking, watchlists, feedback, weekly tuning.                       |
| **Duplicate publication**          | Medium     | Content hash, one-time approval, lookup before retry, durable receipt.                       |
| **Telegram dependency**            | Medium     | Local admin over SSH; durable state independent of Telegram; token rotation runbook.         |
| **Sandbox misconfiguration**       | High       | Fail closed, explicit paths, automated escape tests, no Docker socket.                       |

## 19. Owner selection sheet

| **Area**           | **Recommended**      | **Alternative**                 | **Owner response**               |
|--------------------|----------------------|---------------------------------|----------------------------------|
| **Telegram**       | @llblab/pi-telegram  | pitgram / custom adapter        | □ accept □ choose other          |
| **Scheduler**      | pi-schedule-prompt   | @pi-agents/loop / pi-routines   | □ accept □ choose other          |
| **Daemon sandbox** | @nqbao/pi-sandbox    | pi-sandbox for interactive use  | □ accept □ choose other          |
| **Research**       | pi-scraper           | + pi-web-access fallback       | □ accept □ choose other          |
| **Reddit**         | Custom OAuth adapter | jordanburke MCP                 | □ custom □ MCP                   |
| **X**              | Custom official API  | DataWhisker MCP / Xquik package | □ official □ other               |
| **Rednote**        | xiaohongshu-mcp      | Draft/export only               | □ accept risk □ no auto-publish  |
| **Daily time**     | 08:00 Europe/London  | Other timezone/time             | ________________ |

Recommendation: approve the first four baseline choices, use custom official connectors for Reddit and X, and start Rednote in draft/export-only mode until you are comfortable with browser-session automation.

## 20. Source index

Primary project/package pages and official platform documentation reviewed for this draft. Package versions and counters should be rechecked at implementation time.

| **Source**                      | **Link**                                                                                                                                                                      |
|---------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Pi core repository**          | [github.com/earendil-works/pi](https://github.com/earendil-works/pi)                                                                                                   |
| **Pi SDK documentation**        | [github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)           |
| **Pi packages documentation**   | [github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) |
| **Pi package catalogue**        | [pi.dev/packages](https://pi.dev/packages)                                                                                                                             |
| **@llblab/pi-telegram**         | [pi.dev/packages/%40llblab/pi-telegram](https://pi.dev/packages/%40llblab/pi-telegram)                                                                                 |
| **pi-schedule-prompt**          | [pi.dev/packages/pi-schedule-prompt](https://pi.dev/packages/pi-schedule-prompt)                                                                                       |
| **@nqbao/pi-sandbox**           | [pi.dev/packages/%40nqbao/pi-sandbox](https://pi.dev/packages/%40nqbao/pi-sandbox)                                                                                     |
| **pi-sandbox**                  | [pi.dev/packages/pi-sandbox](https://pi.dev/packages/pi-sandbox)                                                                                                       |
| **pi-scraper**                  | [pi.dev/packages/pi-scraper](https://pi.dev/packages/pi-scraper)                                                                                                       |
| **pi-web-access**               | [pi.dev/packages/pi-web-access](https://pi.dev/packages/pi-web-access)                                                                                                 |
| **pi-mcp-adapter**              | [pi.dev/packages/pi-mcp-adapter](https://pi.dev/packages/pi-mcp-adapter)                                                                                               |
| **x-twitter-scraper**           | [pi.dev/packages/x-twitter-scraper](https://pi.dev/packages/x-twitter-scraper)                                                                                         |
| **xiaohongshu-mcp repository**  | [github.com/xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)                                                                                   |
| **xiaohongshu-mcp Docker tags** | [hub.docker.com/r/xpzouying/xiaohongshu-mcp/tags](https://hub.docker.com/r/xpzouying/xiaohongshu-mcp/tags)                                                             |
| **Reddit MCP alternative**      | [github.com/jordanburke/reddit-mcp-server](https://github.com/jordanburke/reddit-mcp-server)                                                                           |
| **X MCP alternative**           | [github.com/DataWhisker/x-mcp-server](https://github.com/DataWhisker/x-mcp-server)                                                                                     |
| **Telegram Bot API**            | [core.telegram.org/bots/api](https://core.telegram.org/bots/api)                                                                                                       |
| **Bubblewrap**                  | [github.com/containers/bubblewrap](https://github.com/containers/bubblewrap)                                                                                           |
| **Hacker News API**             | [github.com/HackerNews/API](https://github.com/HackerNews/API)                                                                                                         |
| **arXiv API**                   | [info.arxiv.org/help/api/](https://info.arxiv.org/help/api/)                                                                                                           |
| **GitHub REST API**             | [docs.github.com/en/rest](https://docs.github.com/en/rest)                                                                                                             |
| **YouTube Data API**            | [developers.google.com/youtube/v3](https://developers.google.com/youtube/v3)                                                                                           |
| **Reddit Developer**            | [developers.reddit.com/](https://developers.reddit.com/)                                                                                                               |
| **X Developer platform**        | [developer.x.com/](https://developer.x.com/)                                                                                                                           |
| **Rednote open platform**       | [open.xiaohongshu.com/](https://open.xiaohongshu.com/)                                                                                                                 |
