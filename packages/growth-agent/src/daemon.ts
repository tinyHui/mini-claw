#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { AppDatabase } from "./database.js";
import { ApprovalService } from "./approvals.js";
import { health } from "./health.js";
import { log } from "./logger.js";
import { PiSdkRuntime } from "./pi-runtime.js";
import { HeavyJobQueue } from "./queue.js";
import { ReportService } from "./reports.js";
import { DurableScheduler } from "./scheduler.js";
import { configuredSources } from "./sources.js";
import { TelegramGateway } from "./telegram.js";
import type { Platform } from "./types.js";
import { asc } from "drizzle-orm";
import { jobs, watches } from "./schema.js";

export async function main(): Promise<void> {
  const config = loadConfig();
  mkdirSync(config.paths.state, { recursive: true, mode: 0o700 });
  mkdirSync(config.paths.artifacts, { recursive: true, mode: 0o700 });
  const store = await AppDatabase.open(join(config.paths.state, "growth-agent.db"));
  const queue = new HeavyJobQueue();
  const runtime = new PiSdkRuntime(config.paths.workspace);
  const approvals = new ApprovalService(store, config.limits.approvalMinutes);
  void approvals;
  const reports = new ReportService(store, configuredSources(config.sources), runtime, config.paths.artifacts);
  let activeAbort: AbortController | undefined;

  const runReport = (): Promise<{ id: string; path: string; markdown: string }> => queue.enqueue("daily-report", async () => {
    const state = await health(config, store, queue);
    if (state.diskFreePercent < config.limits.diskBlockHeavyPercent) throw new Error("heavy work paused due to disk pressure");
    if (state.temperatureCelsius !== null && state.temperatureCelsius >= config.limits.thermalPauseCelsius) {
      throw new Error("heavy work paused due to temperature");
    }
    activeAbort = new AbortController();
    try { return await reports.generate(); } finally { activeAbort = undefined; }
  });

  const scheduler = new DurableScheduler(store, config, async () => { await runReport(); });
  await scheduler.reconcileInterrupted();
  await scheduler.start();

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = Number(process.env.TELEGRAM_OWNER_ID ?? process.env.ALLOWED_USERS?.split(",")[0]);
  let telegram: TelegramGateway | undefined;
  if (token && Number.isSafeInteger(ownerId)) {
    telegram = new TelegramGateway(token, ownerId, store, {
      health: async () => JSON.stringify(await health(config, store, queue), null, 2),
      brief: async () => {
        const report = await runReport();
        return { text: "Daily growth brief", path: report.path };
      },
      jobs: async () => JSON.stringify(
        await store.orm.select({ id: jobs.id, nextRun: jobs.nextRun, status: jobs.status })
          .from(jobs).orderBy(asc(jobs.id)),
        null,
        2
      ),
      watch: async (value) => {
        if (!value) throw new Error("watch value is required");
        await store.orm.insert(watches).values({
          id: randomUUID(), kind: "topic", value, enabled: true, createdAt: new Date().toISOString()
        }).onConflictDoNothing();
        return `Watching: ${value}`;
      },
      draft: async (platform: Platform, body: string) => {
        const accountKey = `${platform.toUpperCase()}_ACCOUNT_ID`;
        const account = process.env[accountKey];
        if (!account) throw new Error(`${accountKey} must identify the connector account`);
        const draft = await approvals.createDraft({
          platform, account, body, media: [], policyVersion: "v1"
        });
        const request = await approvals.request(draft.id);
        return {
          text: `Preview (${platform}, expires ${request.expiresAt})\n\n${body}\n\nPublishing mode: ${config.connectors[platform]}`,
          token: request.token
        };
      },
      edit: async (draftId, body) => {
        const previous = await approvals.getDraft(draftId);
        const draft = await approvals.revise(draftId, {
          platform: previous.platform,
          account: previous.account,
          ...(previous.target ? { target: previous.target } : {}),
          body,
          media: previous.media,
          ...(previous.replyParent ? { replyParent: previous.replyParent } : {}),
          policyVersion: previous.policyVersion
        });
        const request = await approvals.request(draft.id);
        return {
          text: `Revised preview ${draft.id} (version ${draft.version}, expires ${request.expiresAt})\n\n${body}`,
          token: request.token
        };
      },
      decide: async (approvalToken, decision, actor) => {
        const draft = await approvals.decide(approvalToken, actor, decision);
        if (decision === "rejected") return `Draft ${draft.id} rejected.`;
        if (config.connectors[draft.platform] !== "publish") {
          return `Draft ${draft.id} approved, but ${draft.platform} is draft-only; no external write occurred.`;
        }
        return `Draft ${draft.id} approved. External writes remain gated until the ${draft.platform} compatibility review is recorded as accepted.`;
      },
      stop: async () => { activeAbort?.abort(); return activeAbort ? "Stopping active work." : "No active work."; }
    });
    telegram.start();
  } else {
    log("warn", "telegram disabled; set TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_ID");
  }

  const shutdown = async (signal: string): Promise<void> => {
    log("info", "shutting down", { signal });
    telegram?.stop();
    scheduler.stop();
    activeAbort?.abort();
    await runtime.close();
    store.close();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void shutdown(signal).finally(() => process.exit(0)));
  }
  log("info", "growth agent started", { timezone: config.timezone, reportHour: config.dailyReport.hour });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    log("error", "fatal startup error", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}
