import Bree from "bree";
import { scanCapabilities, type CapabilitySummary } from "./capabilities.js";
import { scanCronJobs, type CronJobDefinition } from "./scanner.js";
import { logger } from "../logger.js";

export interface SchedulerOptions {
	cronDir: string;
	start?: boolean;
}

export interface SchedulerBuildResult {
	bree: Bree;
	jobs: CronJobDefinition[];
	capabilities: CapabilitySummary[];
}

export async function buildCronScheduler(
	options: SchedulerOptions,
): Promise<SchedulerBuildResult> {
	const [jobResult, capabilityResult] = await Promise.all([
		scanCronJobs(options.cronDir),
		scanCapabilities(options.cronDir),
	]);
	const diagnostics = [
		...jobResult.diagnostics.map((diagnostic) => ({ ...diagnostic, operation: "cron_job_scan" })),
		...capabilityResult.diagnostics.map((diagnostic) => ({ ...diagnostic, operation: "cron_capability_scan" })),
	];

	for (const diagnostic of diagnostics) {
		const context = {
			file: diagnostic.file,
			operation: diagnostic.operation,
		};
		if (diagnostic.level === "error") {
			logger.error(diagnostic.message, undefined, context);
		} else {
			logger.warn(diagnostic.message, context);
		}
	}

	logger.info("Cron scheduler scan completed", {
		operation: "cron_scan",
		cronDir: options.cronDir,
		cronJobCount: jobResult.jobs.length,
		capabilityCount: capabilityResult.capabilities.length,
		diagnosticErrorCount: diagnostics.filter((diagnostic) => diagnostic.level === "error").length,
		diagnosticWarningCount: diagnostics.filter((diagnostic) => diagnostic.level === "warn").length,
	});

	const bree = new Bree({
		root: false,
		logger: console,
		jobs: jobResult.jobs.map((job) => ({
			name: job.name,
			path: job.path,
			cron: job.cron,
			hasSeconds: job.hasSeconds,
		})),
	});

	return { bree, jobs: jobResult.jobs, capabilities: capabilityResult.capabilities };
}

export async function startCronScheduler(options: SchedulerOptions): Promise<SchedulerBuildResult> {
	const built = await buildCronScheduler(options);
	logger.info("Starting cron scheduler", {
		operation: "cron_start",
		cronDir: options.cronDir,
		cronJobCount: built.jobs.length,
		capabilityCount: built.capabilities.length,
	});
	await built.bree.start();
	return built;
}
