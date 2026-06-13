import Bree from "bree";
import Database from "better-sqlite3";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCronJobsDir, scanCapabilities } from "./scanner.mjs";
import { logger } from "./logger.mjs";

const cronRuntimeDir = dirname(fileURLToPath(import.meta.url));
const genericRunnerPath = resolve(cronRuntimeDir, "generic-runner.mjs");

function getDefaultDatabasePath() {
	return resolve(process.cwd(), "miniclaw.db");
}

async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function readEnabledCronJobs(cronDir, dbPath = getDefaultDatabasePath()) {
	const sqlite = new Database(dbPath, { fileMustExist: true });
	try {
		const rows = sqlite.prepare(`
			SELECT name, description, cronExpression, enabled, hasSeconds, scriptPath, schedulePath, contentHash, validatedAt
			FROM cron_jobs
			WHERE enabled = 1
			ORDER BY name
		`).all();
		const jobsDir = getCronJobsDir(cronDir);
		const enabledRows = [];

		for (const row of rows) {
			const scriptPath = resolve(jobsDir, `${row.name}.mjs`);
			if (await pathExists(scriptPath)) {
				enabledRows.push(row);
				continue;
			}

			sqlite.prepare("UPDATE cron_jobs SET enabled = 0 WHERE name = ?").run(row.name);
			logger.warn("Disabled cron job because its script file is missing", {
				operation: "cron_job_disabled_missing_file",
				jobName: row.name,
				file: scriptPath,
			});
		}

		return enabledRows;
	} finally {
		sqlite.close();
	}
}

export async function buildCronScheduler(options) {
	const [jobs, capabilityResult] = await Promise.all([
		readEnabledCronJobs(options.cronDir, options.dbPath),
		scanCapabilities(options.cronDir),
	]);
	const diagnostics = capabilityResult.diagnostics.map((diagnostic) => ({
		...diagnostic,
		operation: "cron_capability_scan",
	}));

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
		cronJobCount: jobs.length,
		capabilityCount: capabilityResult.rows.length,
		diagnosticErrorCount: diagnostics.filter((diagnostic) => diagnostic.level === "error").length,
		diagnosticWarningCount: diagnostics.filter((diagnostic) => diagnostic.level === "warn").length,
	});

	const bree = new Bree({
		root: false,
		logger: console,
		jobs: jobs.map((job) => ({
			name: job.name,
			path: genericRunnerPath,
			cron: job.cronExpression,
			hasSeconds: job.hasSeconds === 1,
			worker: {
				workerData: {
					task: job.name,
					cronDir: options.cronDir,
				},
			},
		})),
	});

	return { bree, jobs, capabilities: capabilityResult.rows };
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
