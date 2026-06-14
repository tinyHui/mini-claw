---
name: cron-job-authoring
description: Use when the user asks Mini-Claw to create, update, or maintain scheduled recurring agent work. Guides generation of generated/cron/jobs/*.mjs, generated/cron/jobs/*.cron, and reusable generated/cron/capabilities. Jobs only need to produce the content about what to communicate; send-message delivery is already wrapped by Mini-Claw.
---

# Cron Job Authoring

## Overview

Mini-Claw cron jobs live under the repository `generated/cron/` directory and run in a separate Bree scheduler process managed by pm2. Users do not manage cron through Telegram slash commands. When a normal user message asks to schedule recurring autonomous work, create or update cron artifacts.

Use the `generate_cron_artifacts` tool for non-trivial job or capability generation. Keep generated code scoped to `generated/cron/jobs` and `generated/cron/capabilities`.

## Required Structure

```text
generated/cron/
  jobs/
    <name>.mjs
    <name>.cron
  capabilities/
    <seq-name>/
      manifest.yaml
      index.mjs
      other-helper-files.mjs
```

Job names must be a single safe path component using letters, numbers, dashes, or underscores.

## Job Files

Each job needs a `.mjs` file and a sibling `.cron` file with the same base name.
Each job `.mjs` file must include a static top-level description comment so Mini-Claw can index it without executing job code, and must export an async `run()` function that returns a string containing the message content to communicate:

```js
// description: Prepares a daily Hacker News digest message.
```

Example `generated/cron/jobs/hackernews_digest.mjs`:

```js
// description: Prepares a daily Hacker News digest message.
import { fetchTopStories } from "#cron/capabilities/001-hackernews/index.mjs";
import { summarizeStories } from "#cron/capabilities/002-llm-summary/index.mjs";

export async function run() {
  const stories = await fetchTopStories({ limit: 10 });
  const summary = await summarizeStories({ stories });

  return `Daily Hacker News digest\n\n${summary}`;
}
```

Example `generated/cron/jobs/hackernews_digest.cron`:

```cron
0 8 * * *
```

Cron job `run()` functions must return a string. Mini-Claw's generic cron runner persists that returned string to the cron output outbox, and the existing send-message wrapper handles delivery. Do not add a specific capability for sending Telegram messages, and do not call cron output publishing APIs from generated jobs. The job should focus on deciding what to communicate, not on making the communication.

## Capability Files

Each capability should do one reusable thing, such as fetching Hacker News, scraping a feed, calling an LLM summarizer, or formatting a report.

Example `generated/cron/capabilities/001-hackernews/manifest.yaml`:

```yaml
name: hackernews
description: Fetches top Hacker News stories from the public Firebase API.
input_schema:
  type: object
  properties:
    limit:
      type: integer
      minimum: 1
      maximum: 30
  required: [limit]
output_schema:
  type: object
  properties:
    stories:
      type: array
      items:
        type: object
  required: [stories]
```

Example `generated/cron/capabilities/001-hackernews/index.mjs`:

```js
export async function fetchTopStories({ limit }) {
  const ids = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json").then((res) => res.json());
  const stories = await Promise.all(
    ids.slice(0, limit).map((id) =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((res) => res.json())
    )
  );
  return { stories };
}
```

## Workflow

1. Infer the schedule and desired behavior from the user's normal message.
2. If the schedule is ambiguous, ask a concise clarification before generating files.
3. Use `generate_cron_artifacts` with the user's request and clarified schedule.
4. Report the generated files and any validation errors.

## Constraints

- Do not edit files outside `generated/cron/jobs` or `generated/cron/capabilities` for cron generation.
- Do not duplicate capability logic when an existing capability can be reused.
- Keep jobs small; put reusable or external-service logic in capabilities.
- Do not manually restart or report on `mini-claw-cron` from this skill prompt; scheduler reload behavior belongs to the cron generation process.
