import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import {
	extractJobDescription,
	hasCronSeconds,
	parseCapabilityManifest,
	validateCapabilitySlug,
	validateCronExpression,
	validateJobName,
	type ValidationDiagnostic,
} from "./validation.js";
import {
	APP_CRON_JOBS_DIR,
	getCapabilityEntrypointFileName,
	getCapabilityEntrypointPath,
	getCapabilityManifestFileName,
	getCapabilityManifestPath,
	getDefaultAppCronJobsDir,
	getCronCapabilitiesDir,
	getCronJobsDir,
	getAppJobRuntimeFileName,
	getAppJobScheduleFileName,
	getJobScheduleFileName,
	getJobSchedulePath,
	getJobScriptFileName,
	getJobScriptPath,
} from "./paths.js";

export interface CronJobRegistryRow {
	name: string;
	description: string;
	cronExpression: string;
	hasSeconds: 0 | 1;
	scriptPath: string;
	schedulePath: string;
	contentHash: string;
	validatedAt: string;
}

export interface CronCapabilityRegistryRow {
	slug: string;
	name: string;
	description: string;
	manifestPath: string;
	entrypointPath: string;
	inputSchemaJson: string;
	outputSchemaJson: string;
	contentHash: string;
	validatedAt: string;
}

export interface CronValidationResult {
	ok: boolean;
	counts: {
		jobs: number;
		capabilities: number;
		errors: number;
		warnings: number;
	};
	successes: Array<{ type: "job" | "capability"; name: string; file: string }>;
	warnings: ValidationDiagnostic[];
	errors: ValidationDiagnostic[];
	jobs: CronJobRegistryRow[];
	capabilities: CronCapabilityRegistryRow[];
	registry?: {
		dbPath: string;
		jobsWritten: number;
		capabilitiesWritten: number;
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function repoRelative(path: string): string {
	return relative(process.cwd(), path).split(sep).join("/");
}

function contentHash(parts: string[]): string {
	const hash = createHash("sha256");
	for (const part of parts) {
		hash.update(part);
		hash.update("\0");
	}
	return hash.digest("hex");
}

interface JobDirScanOptions {
	jobsDir: string;
	scriptExtension: ".mjs" | ".ts";
	scriptPathForName(name: string): string;
	schedulePathForName(name: string): string;
	scriptRegistryPathForName(name: string): string;
	scheduleRegistryPathForName(name: string): string;
	validatedAt: string;
}

async function scanJobDirectory(options: JobDirScanOptions) {
	const jobsDir = options.jobsDir;
	const diagnostics: ValidationDiagnostic[] = [];
	const successes: Array<{ type: "job"; name: string; file: string }> = [];
	const rows: CronJobRegistryRow[] = [];

	if (!(await pathExists(jobsDir))) {
		return { rows, diagnostics, successes };
	}

	const entries = await readdir(jobsDir, { withFileTypes: true });
	const jobScripts = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(options.scriptExtension))
		.map((entry) => entry.name)
		.sort();
	const cronFiles = new Set(
		entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".cron"))
			.map((entry) => entry.name),
	);

	for (const scriptFile of jobScripts) {
		const name = basename(scriptFile, options.scriptExtension);
		const scriptPath = options.scriptPathForName(name);
		const scheduleFile = getAppJobScheduleFileName(name);
		const schedulePath = options.schedulePathForName(name);
		let hasErrors = false;

		for (const message of validateJobName(name)) {
			hasErrors = true;
			diagnostics.push({ level: "error", file: scriptPath, message });
		}

		if (!cronFiles.has(scheduleFile)) {
			hasErrors = true;
			diagnostics.push({
				level: "error",
				file: scriptPath,
				message: `Missing schedule file ${scheduleFile}.`,
			});
		}

		const script = await readFile(scriptPath, "utf-8");
		const description = extractJobDescription(script);
		if (!description) {
			hasErrors = true;
			diagnostics.push({
				level: "error",
				file: scriptPath,
				message: "Job script is missing required top-level '// description: ...' comment.",
			});
		}

		let cronExpression = "";
		if (cronFiles.has(scheduleFile)) {
			cronExpression = (await readFile(schedulePath, "utf-8")).trim();
			for (const message of validateCronExpression(cronExpression)) {
				hasErrors = true;
				diagnostics.push({ level: "error", file: schedulePath, message });
			}
		}

		if (hasErrors) continue;

		rows.push({
			name,
			description: description ?? "",
			cronExpression,
			hasSeconds: hasCronSeconds(cronExpression) ? 1 : 0,
			scriptPath: options.scriptRegistryPathForName(name),
			schedulePath: options.scheduleRegistryPathForName(name),
			contentHash: contentHash([script, cronExpression]),
			validatedAt: options.validatedAt,
		});
		successes.push({ type: "job", name, file: repoRelative(scriptPath) });
	}

	for (const cronFile of cronFiles) {
		const name = basename(cronFile, ".cron");
		if (!jobScripts.includes(`${name}${options.scriptExtension}`)) {
			diagnostics.push({
				level: "warn",
				file: resolve(jobsDir, cronFile),
				message: `Schedule file ${cronFile} has no matching ${name}${options.scriptExtension} job.`,
			});
		}
	}

	return { rows, diagnostics, successes };
}

function duplicateJobDiagnostics(rows: CronJobRegistryRow[]): ValidationDiagnostic[] {
	const seen = new Map<string, string>();
	const diagnostics: ValidationDiagnostic[] = [];
	for (const row of rows) {
		const firstPath = seen.get(row.name);
		if (!firstPath) {
			seen.set(row.name, row.scriptPath);
			continue;
		}
		diagnostics.push({
			level: "error",
			file: row.scriptPath,
			message: `Duplicate cron job name "${row.name}" also found at ${firstPath}.`,
		});
	}
	return diagnostics;
}

export async function scanCronJobs(
	cronDir: string,
	validatedAt = new Date().toISOString(),
	appJobsDir = getDefaultAppCronJobsDir(),
) {
	const generated = await scanJobDirectory({
		jobsDir: getCronJobsDir(cronDir),
		scriptExtension: ".mjs",
		scriptPathForName: (name) => getJobScriptPath(cronDir, name),
		schedulePathForName: (name) => getJobSchedulePath(cronDir, name),
		scriptRegistryPathForName: (name) => getJobScriptFileName(name),
		scheduleRegistryPathForName: (name) => getJobScheduleFileName(name),
		validatedAt,
	});
	const bundled = await scanJobDirectory({
		jobsDir: appJobsDir,
		scriptExtension: ".ts",
		scriptPathForName: (name) => join(appJobsDir, `${name}.ts`),
		schedulePathForName: (name) => join(appJobsDir, `${name}.cron`),
		scriptRegistryPathForName: (name) => join(APP_CRON_JOBS_DIR, getAppJobRuntimeFileName(name)),
		scheduleRegistryPathForName: (name) => join(APP_CRON_JOBS_DIR, getAppJobScheduleFileName(name)),
		validatedAt,
	});
	const rows = [...generated.rows, ...bundled.rows];
	const duplicateDiagnostics = duplicateJobDiagnostics(rows);
	const duplicateNames = new Set(
		duplicateDiagnostics.map((diagnostic) => diagnostic.message.match(/"([^"]+)"/)?.[1]).filter(Boolean),
	);

	return {
		rows: rows.filter((row) => !duplicateNames.has(row.name)),
		diagnostics: [...generated.diagnostics, ...bundled.diagnostics, ...duplicateDiagnostics],
		successes: [...generated.successes, ...bundled.successes].filter((success) => !duplicateNames.has(success.name)),
	};
}

export async function scanCapabilities(cronDir: string, validatedAt = new Date().toISOString()) {
	const capabilitiesDir = getCronCapabilitiesDir(cronDir);
	const diagnostics: ValidationDiagnostic[] = [];
	const successes: Array<{ type: "capability"; name: string; file: string }> = [];
	const rows: CronCapabilityRegistryRow[] = [];

	if (!(await pathExists(capabilitiesDir))) {
		return { rows, diagnostics, successes };
	}

	const entries = await readdir(capabilitiesDir, { withFileTypes: true });
	for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
		const slug = entry.name;
		const manifestPath = getCapabilityManifestPath(cronDir, slug);
		const entrypointPath = getCapabilityEntrypointPath(cronDir, slug);
		let hasErrors = false;

		for (const message of validateCapabilitySlug(slug)) {
			hasErrors = true;
			diagnostics.push({ level: "error", file: resolve(capabilitiesDir, slug), message });
		}

		if (!(await pathExists(manifestPath))) {
			hasErrors = true;
			diagnostics.push({
				level: "error",
				file: manifestPath,
				message: "Capability is missing manifest.yaml.",
			});
		}

		if (!(await pathExists(entrypointPath))) {
			hasErrors = true;
			diagnostics.push({
				level: "error",
				file: entrypointPath,
				message: "Capability is missing index.mjs.",
			});
		}

		let manifestContent = "";
		let entrypointContent = "";
		let manifest;
		if (await pathExists(manifestPath)) {
			manifestContent = await readFile(manifestPath, "utf-8");
			const parsed = parseCapabilityManifest(manifestContent, manifestPath);
			diagnostics.push(...parsed.diagnostics);
			if (parsed.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
				hasErrors = true;
			}
			manifest = parsed.manifest;
		}

		if (await pathExists(entrypointPath)) {
			entrypointContent = await readFile(entrypointPath, "utf-8");
		}

		if (hasErrors || !manifest) continue;

		rows.push({
			slug,
			name: manifest.name,
			description: manifest.description,
			manifestPath: getCapabilityManifestFileName(),
			entrypointPath: getCapabilityEntrypointFileName(),
			inputSchemaJson: JSON.stringify(manifest.input_schema),
			outputSchemaJson: JSON.stringify(manifest.output_schema),
			contentHash: contentHash([manifestContent, entrypointContent]),
			validatedAt,
		});
		successes.push({ type: "capability", name: slug, file: repoRelative(manifestPath) });
	}

	return { rows, diagnostics, successes };
}

export async function validateCronRuntime(
	cronDir: string,
	appJobsDir = getDefaultAppCronJobsDir(),
): Promise<CronValidationResult> {
	const validatedAt = new Date().toISOString();
	const [jobs, capabilities] = await Promise.all([
		scanCronJobs(resolve(cronDir), validatedAt, appJobsDir),
		scanCapabilities(resolve(cronDir), validatedAt),
	]);
	const diagnostics = [...jobs.diagnostics, ...capabilities.diagnostics];
	const errors = diagnostics.filter((diagnostic) => diagnostic.level === "error");
	const warnings = diagnostics.filter((diagnostic) => diagnostic.level === "warn");

	return {
		ok: errors.length === 0,
		counts: {
			jobs: jobs.rows.length,
			capabilities: capabilities.rows.length,
			errors: errors.length,
			warnings: warnings.length,
		},
		successes: [...jobs.successes, ...capabilities.successes],
		warnings,
		errors,
		jobs: jobs.rows,
		capabilities: capabilities.rows,
	};
}
