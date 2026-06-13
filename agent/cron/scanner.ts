import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
	hasCronSeconds,
	type ValidationDiagnostic,
	validateCronExpression,
	validateJobName,
} from "./validation.js";

export interface CronJobDefinition {
	name: string;
	path: string;
	cron: string;
	hasSeconds?: boolean;
}

export interface CronScanResult {
	jobs: CronJobDefinition[];
	diagnostics: ValidationDiagnostic[];
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export function getCronJobsDir(cronDir: string): string {
	return join(cronDir, "jobs");
}

export async function scanCronJobs(cronDir: string): Promise<CronScanResult> {
	const jobsDir = getCronJobsDir(cronDir);
	const diagnostics: ValidationDiagnostic[] = [];
	const jobs: CronJobDefinition[] = [];

	if (!(await pathExists(jobsDir))) {
		return { jobs, diagnostics };
	}

	const entries = await readdir(jobsDir, { withFileTypes: true });
	const jobScripts = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
		.map((entry) => entry.name)
		.sort();
	const cronFiles = new Set(
		entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".cron"))
			.map((entry) => entry.name),
	);

	for (const scriptFile of jobScripts) {
		const name = basename(scriptFile, ".mjs");
		const scriptPath = resolve(jobsDir, scriptFile);
		const cronFile = `${name}.cron`;
		const cronPath = resolve(jobsDir, cronFile);
		const nameErrors = validateJobName(name);
		for (const message of nameErrors) {
			diagnostics.push({ level: "error", file: scriptPath, message });
		}
		if (nameErrors.length > 0) continue;

		if (!cronFiles.has(cronFile)) {
			diagnostics.push({
				level: "error",
				file: scriptPath,
				message: `Missing schedule file ${cronFile}.`,
			});
			continue;
		}

		const cron = (await readFile(cronPath, "utf-8")).trim();
		const cronErrors = validateCronExpression(cron);
		for (const message of cronErrors) {
			diagnostics.push({ level: "error", file: cronPath, message });
		}
		if (cronErrors.length > 0) continue;

		jobs.push({
			name,
			path: scriptPath,
			cron,
			hasSeconds: hasCronSeconds(cron) || undefined,
		});
	}

	for (const cronFile of cronFiles) {
		const name = basename(cronFile, ".cron");
		if (!jobScripts.includes(`${name}.mjs`)) {
			diagnostics.push({
				level: "warn",
				file: resolve(jobsDir, cronFile),
				message: `Schedule file ${cronFile} has no matching ${name}.mjs job.`,
			});
		}
	}

	return { jobs, diagnostics };
}
