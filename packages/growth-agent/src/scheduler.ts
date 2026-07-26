import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./database.js";
import { log } from "./logger.js";
import { eq } from "drizzle-orm";
import { jobRuns, jobs } from "./schema.js";

export function nextDailyRun(now: Date, timezone: string, hour: number, minute: number): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const localNowMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const dayOffset = localNowMinutes < hour * 60 + minute ? 0 : 1;
  const candidateUtc = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + dayOffset, hour, minute));
  const candidateParts = Object.fromEntries(formatter.formatToParts(candidateUtc).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const desired = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + dayOffset, hour, minute);
  const represented = Date.UTC(Number(candidateParts.year), Number(candidateParts.month) - 1, Number(candidateParts.day), Number(candidateParts.hour), Number(candidateParts.minute));
  return new Date(candidateUtc.getTime() + desired - represented);
}

export class DurableScheduler {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly store: AppDatabase,
    private readonly config: AppConfig,
    private readonly runDaily: () => Promise<void>
  ) {}

  async start(): Promise<void> {
    const now = new Date();
    const next = nextDailyRun(now, this.config.timezone, this.config.dailyReport.hour, this.config.dailyReport.minute);
    const values = {
      id: "daily-report",
      schedule: `${this.config.dailyReport.minute} ${this.config.dailyReport.hour} * * *`,
      timezone: this.config.timezone,
      profile: "research",
      nextRun: next.toISOString(),
      status: "scheduled",
      missedPolicy: `run-if-late-under-${this.config.dailyReport.missedRunHours}h`,
      updatedAt: now.toISOString()
    };
    await this.store.orm.insert(jobs).values(values).onConflictDoUpdate({
      target: jobs.id,
      set: {
        schedule: values.schedule,
        timezone: values.timezone,
        profile: values.profile,
        nextRun: values.nextRun,
        status: values.status,
        missedPolicy: values.missedPolicy,
        updatedAt: values.updatedAt
      }
    });
    this.schedule(next);
  }

  async reconcileInterrupted(): Promise<void> {
    await this.store.orm.update(jobRuns).set({
      status: "interrupted", finishedAt: new Date().toISOString()
    }).where(eq(jobRuns.status, "running"));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(next: Date): void {
    if (this.stopped) return;
    const delay = Math.max(0, Math.min(next.getTime() - Date.now(), 2_147_000_000));
    this.timer = setTimeout(() => void this.fire(), delay);
  }

  private async fire(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.runDaily();
    } catch (error) {
      log("error", "scheduled report failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      const next = nextDailyRun(new Date(), this.config.timezone, this.config.dailyReport.hour, this.config.dailyReport.minute);
      await this.store.orm.update(jobs).set({
        nextRun: next.toISOString(), status: "scheduled", updatedAt: new Date().toISOString()
      }).where(eq(jobs.id, "daily-report"));
      this.schedule(next);
    }
  }
}
