import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeLogger, logger } from "./logger.js";
import { startCronScheduler } from "./scheduler-runtime.js";
import { getDefaultGeneratedCronDir } from "./paths.js";

const schedulerDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(schedulerDir, "..", "..");
const cronDir = resolve(process.env.MINI_CLAW_CRON_DIR || getDefaultGeneratedCronDir(appRoot));
const logWorkspace = process.env.MINI_CLAW_WORKSPACE || appRoot;
const logLevel = process.env.LOG_LEVEL || "info";

initializeLogger(logLevel, logWorkspace);

logger.info("Initializing cron scheduler", {
	operation: "cron_boot",
	appRoot,
	cronDir,
	logWorkspace,
	logLevel,
});

const scheduler = await startCronScheduler({ cronDir, appRoot });

logger.info("Cron scheduler ready", {
	operation: "cron_ready",
	cronJobCount: scheduler.jobs.length,
	capabilityCount: scheduler.capabilities.length,
});

const shutdown = async () => {
	logger.info("Stopping cron scheduler", { operation: "cron_shutdown" });
	await scheduler.bree.stop();
	process.exit(0);
};

process.on("SIGINT", () => {
	void shutdown();
});

process.on("SIGTERM", () => {
	void shutdown();
});
