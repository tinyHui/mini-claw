import Bree from "bree";
import { resolve } from "node:path";
import { scanCapabilities, scanCronJobs } from "./scanner.mjs";
import { logger } from "./logger.mjs";

export async function buildCronScheduler(options) {
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
		cronJobCount: jobResult.rows.length,
		capabilityCount: capabilityResult.rows.length,
		diagnosticErrorCount: diagnostics.filter((diagnostic) => diagnostic.level === "error").length,
		diagnosticWarningCount: diagnostics.filter((diagnostic) => diagnostic.level === "warn").length,
	});

	const bree = new Bree({
		root: false,
		logger: console,
		jobs: jobResult.rows.map((job) => ({
			name: job.name,
			path: resolve(process.cwd(), job.scriptPath),
			cron: job.cronExpression,
			hasSeconds: job.hasSeconds === 1,
		})),
	});

	return { bree, jobs: jobResult.rows, capabilities: capabilityResult.rows };
}

export async function startCronScheduler(options) {
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
