import Bree from "bree";
import { scanCronJobs, type CronJobDefinition } from "./scanner.js";
import { logger } from "../logger.js";

export interface SchedulerOptions {
	cronDir: string;
	start?: boolean;
}

export interface SchedulerBuildResult {
	bree: Bree;
	jobs: CronJobDefinition[];
}

export async function buildCronScheduler(
	options: SchedulerOptions,
): Promise<SchedulerBuildResult> {
	const result = await scanCronJobs(options.cronDir);
	for (const diagnostic of result.diagnostics) {
		const context = {
			file: diagnostic.file,
			operation: "cron_scan",
		};
		if (diagnostic.level === "error") {
			logger.error(diagnostic.message, undefined, context);
		} else {
			logger.warn(diagnostic.message, context);
		}
	}

	const bree = new Bree({
		root: false,
		logger: console,
		jobs: result.jobs.map((job) => ({
			name: job.name,
			path: job.path,
			cron: job.cron,
			hasSeconds: job.hasSeconds,
		})),
	});

	return { bree, jobs: result.jobs };
}

export async function startCronScheduler(options: SchedulerOptions): Promise<SchedulerBuildResult> {
	const built = await buildCronScheduler(options);
	logger.info("Starting cron scheduler", {
		operation: "cron_start",
		cronJobCount: built.jobs.length,
	});
	await built.bree.start();
	return built;
}
