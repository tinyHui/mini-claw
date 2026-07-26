import { statfsSync, readFileSync } from "node:fs";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./database.js";
import type { HeavyJobQueue } from "./queue.js";

export interface Health {
  ok: boolean;
  database: string;
  diskFreePercent: number;
  temperatureCelsius: number | null;
  heavyJob: string | null;
  checkedAt: string;
  warnings: string[];
}

export async function health(config: AppConfig, store: AppDatabase, queue: HeavyJobQueue): Promise<Health> {
  const disk = statfsSync(config.paths.state);
  const free = Number(disk.bavail) / Number(disk.blocks) * 100;
  let temperature: number | null = null;
  try { temperature = Number(readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8").trim()) / 1000; } catch {}
  const database = await store.integrityCheck();
  const warnings: string[] = [];
  if (free < config.limits.diskWarnPercent) warnings.push("disk pressure");
  if (temperature !== null && temperature >= config.limits.thermalPauseCelsius) warnings.push("thermal pause");
  if (database !== "ok") warnings.push("database integrity");
  return {
    ok: warnings.length === 0,
    database,
    diskFreePercent: Math.round(free * 10) / 10,
    temperatureCelsius: temperature,
    heavyJob: queue.status().active,
    checkedAt: new Date().toISOString(),
    warnings
  };
}
