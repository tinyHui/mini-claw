import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const valid = `
version: 1
timezone: Europe/London
dailyReport: { hour: 7, minute: 0, missedRunHours: 6 }
paths: { state: ./state, artifacts: ./artifacts, workspace: ./workspace }
limits:
  maxConcurrentHeavyJobs: 1
  approvalMinutes: 15
  dailyWritesPerPlatform: 1
  diskWarnPercent: 20
  diskBlockHeavyPercent: 15
  diskCriticalPercent: 10
  thermalPauseCelsius: 75
connectors: { reddit: draft, x: draft, rednote: draft, dryRunUntil: null }
sources:
  hackernews: { enabled: true, maxItems: 40 }
`;

describe("loadConfig", () => {
  it("loads and resolves a valid configuration", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-claw-config-"));
    const path = join(dir, "config.yaml");
    writeFileSync(path, valid);
    const config = loadConfig(path);
    expect(config.dailyReport.hour).toBe(7);
    expect(config.limits.maxConcurrentHeavyJobs).toBe(1);
    expect(config.paths.state).toMatch(/state$/);
  });

  it("rejects unsafe state roots", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-claw-config-"));
    const path = join(dir, "config.yaml");
    writeFileSync(path, valid.replace("./state", "/"));
    expect(() => loadConfig(path)).toThrow(/root or home/);
  });
});
