import { describe, expect, it } from "vitest";
import { nextDailyRun } from "../src/scheduler.js";

describe("nextDailyRun", () => {
  it("schedules 07:00 London before the daily cutoff", () => {
    const next = nextDailyRun(new Date("2026-01-15T06:00:00Z"), "Europe/London", 7, 0);
    expect(next.toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });

  it("accounts for British Summer Time", () => {
    const next = nextDailyRun(new Date("2026-07-15T05:00:00Z"), "Europe/London", 7, 0);
    expect(next.toISOString()).toBe("2026-07-15T06:00:00.000Z");
  });
});
