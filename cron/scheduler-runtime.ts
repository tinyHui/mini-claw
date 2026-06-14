import Bree from "bree";
import Database from "better-sqlite3";
import { stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeCronRegistry } from "./registry.js";
import { validateCronRuntime, type CronValidationResult } from "./scanner.js";
import { logger } from "./logger.js";
import { getDefaultAppCronJobsDir, getJobScriptPath } from "./paths.js";

const cronRuntimeDir = dirname(fileURLToPath(import.meta.url));
const genericRunnerPath = resolve(cronRuntimeDir, "generic-runner.js");

interface CronSchedulerOptions {
	cronDir: string;
	dbPath?: string;
	appRoot?: string;
}

interface EnabledCronJobRow {
	name: string;
	description: string;
	cronExpression: string;
	enabled: number;
	hasSeconds: number;
	scriptPath: string;
	schedulePath: string;
	contentHash: string;
	validatedAt: string;
}

function getDefaultDatabasePath() {
	return resolve(process.cwd(), "miniclaw.db");
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function resolveJobModulePath(job: Pick<EnabledCronJobRow, "name" | "scriptPath">, cronDir: string, appRoot: string): Promise<string | undefined> {
	const generatedPath = getJobScriptPath(cronDir, job.name);
	if (job.scriptPath === `${job.name}.mjs` && await pathExists(generatedPath)) {
		return generatedPath;
	}

	const appPath = resolve(appRoot, job.scriptPath);
	if (await pathExists(appPath)) {
		return appPath;
	}

	if (extname(appPath) === ".js") {
		const sourcePath = appPath.slice(0, -".js".length) + ".ts";
		if (await pathExists(sourcePath)) return sourcePath;
	}

	return undefined;
}

function allowsNoOutput(job: Pick<EnabledCronJobRow, "scriptPath">): boolean {
	return job.scriptPath.startsWith("cron/jobs/");
}

async function readEnabledCronJobs(
	cronDir: string,
	dbPath = getDefaultDatabasePath(),
	appRoot = process.cwd(),
): Promise<Array<EnabledCronJobRow & { modulePath: string; allowNoOutput: boolean }>> {
	const sqlite = new Database(dbPath, { fileMustExist: true });
	try {
		const rows = sqlite.prepare(`
			SELECT name, description, cronExpression, enabled, hasSeconds, scriptPath, schedulePath, contentHash, validatedAt
			FROM cron_jobs
			WHERE enabled = 1
			ORDER BY name
		`).all() as EnabledCronJobRow[];
		const enabledRows: Array<EnabledCronJobRow & { modulePath: string; allowNoOutput: boolean }> = [];

		for (const row of rows) {
			const modulePath = await resolveJobModulePath(row, cronDir, appRoot);
			if (modulePath) {
				enabledRows.push({
					...row,
					modulePath,
					allowNoOutput: allowsNoOutput(row),
				});
				continue;
			}

			sqlite.prepare("DELETE FROM cron_jobs WHERE name = ?").run(row.name);
			logger.warn("Deleted cron job registry row because its script file is missing", {
				operation: "cron_job_deleted_missing_file",
				jobName: row.name,
				file: row.scriptPath,
			});
		}

		return enabledRows;
	} finally {
		sqlite.close();
	}
}

function logValidationDiagnostics(validation: CronValidationResult): void {
	for (const diagnostic of [...validation.errors, ...validation.warnings]) {
		const context = {
			file: diagnostic.file,
			operation: diagnostic.type ? `cron_${diagnostic.type}_scan` : "cron_scan",
		};
		if (diagnostic.level === "error") {
			logger.error(diagnostic.message, undefined, context);
		} else {
			logger.warn(diagnostic.message, context);
		}
	}
}

export async function buildCronScheduler(options: CronSchedulerOptions) {
	const appRoot = options.appRoot ?? process.cwd();
	const validation = await validateCronRuntime(resolve(options.cronDir), getDefaultAppCronJobsDir(appRoot));
	logValidationDiagnostics(validation);

	logger.info("Cron file validation completed", {
		operation: "cron_validation",
		cronDir: options.cronDir,
		cronJobCount: validation.jobs.length,
		capabilityCount: validation.capabilities.length,
		diagnosticErrorCount: validation.errors.length,
		diagnosticWarningCount: validation.warnings.length,
	});

	if (!validation.ok) {
		throw new Error("Cron scheduler startup failed because cron files did not pass validation.");
	}

	const registry = writeCronRegistry(validation, options.dbPath);
	const jobs = await readEnabledCronJobs(options.cronDir, options.dbPath, appRoot);

	logger.info("Cron scheduler scan completed", {
		operation: "cron_scan",
		cronDir: options.cronDir,
		cronJobCount: jobs.length,
		capabilityCount: validation.capabilities.length,
		registryJobCount: registry.jobsWritten,
		registryCapabilityCount: registry.capabilitiesWritten,
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
					modulePath: job.modulePath,
					allowNoOutput: job.allowNoOutput,
				},
			},
		})),
	});

	return { bree, jobs, capabilities: validation.capabilities };
}

export async function startCronScheduler(options: CronSchedulerOptions) {
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
