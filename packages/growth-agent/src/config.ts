import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { ConnectorModeSchema } from "./types.js";

const PathSchema = z.string().min(1).transform((value, context) => {
  const path = resolve(value);
  if (path === "/" || path === process.env.HOME) {
    context.addIssue({ code: "custom", message: "cannot be root or home" });
    return z.NEVER;
  }
  return path;
});

export const AppConfigSchema = z.object({
  version: z.literal(1),
  timezone: z.string().min(1),
  dailyReport: z.object({
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    missedRunHours: z.number().int().min(0).max(24)
  }),
  paths: z.object({
    state: PathSchema,
    artifacts: PathSchema,
    workspace: PathSchema
  }),
  limits: z.object({
    maxConcurrentHeavyJobs: z.literal(1),
    approvalMinutes: z.number().int().min(1).max(60),
    dailyWritesPerPlatform: z.number().int().min(0).max(10),
    diskWarnPercent: z.number().int().min(1).max(90),
    diskBlockHeavyPercent: z.number().int().min(1).max(90),
    diskCriticalPercent: z.number().int().min(1).max(90),
    thermalPauseCelsius: z.number().int().min(50).max(90)
  }),
  connectors: z.object({
    reddit: ConnectorModeSchema,
    x: ConnectorModeSchema,
    rednote: ConnectorModeSchema,
    dryRunUntil: z.iso.datetime().nullable()
  }),
  sources: z.record(z.string(), z.object({
    enabled: z.boolean(),
    maxItems: z.number().int().min(1).max(100)
  }))
}).superRefine((config, context) => {
  if (!(config.limits.diskCriticalPercent < config.limits.diskBlockHeavyPercent &&
    config.limits.diskBlockHeavyPercent < config.limits.diskWarnPercent)) {
    context.addIssue({
      code: "custom",
      path: ["limits"],
      message: "disk thresholds must satisfy critical < blockHeavy < warn"
    });
  }
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function loadConfig(path = process.env.MINI_CLAW_CONFIG ?? "config/local.yaml"): AppConfig {
  return AppConfigSchema.parse(YAML.parse(readFileSync(resolve(path), "utf8")));
}
