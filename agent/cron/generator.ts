import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Codex, type FileChangeItem, type ThreadItem } from "@openai/codex-sdk";
import { scanCapabilities } from "./capabilities.js";
import { restartCronPm2, type Pm2RestartResult } from "./pm2.js";
import { getCronJobsDir, scanCronJobs } from "./scanner.js";
import type { ValidationDiagnostic } from "./validation.js";

export interface GenerateCronArtifactsInput {
	request: string;
	cronDir: string;
	appRoot: string;
	restartCron?: boolean;
}

export interface GenerateCronArtifactsResult {
	summary: string;
	files: string[];
	diagnostics: ValidationDiagnostic[];
	finalResponse: string;
	pm2Restart?: Pm2RestartResult;
}

interface CodexLike {
	startThread(options?: {
		workingDirectory?: string;
		sandboxMode?: "workspace-write";
		skipGitRepoCheck?: boolean;
		approvalPolicy?: "never";
		networkAccessEnabled?: boolean;
	}): {
		run(input: string, options?: { outputSchema?: unknown }): Promise<{
			finalResponse: string;
			items: ThreadItem[];
		}>;
	};
}

export interface GenerateCronArtifactsOptions {
	codex?: CodexLike;
	restartCronProcess?: (appRoot: string) => Promise<Pm2RestartResult>;
}

const OUTPUT_SCHEMA = {
	type: "object",
	properties: {
		summary: { type: "string" },
		files: {
			type: "array",
			items: { type: "string" },
		},
	},
	required: ["summary", "files"],
	additionalProperties: false,
};

async function ensureCronDirectories(cronDir: string): Promise<void> {
	await mkdir(getCronJobsDir(cronDir), { recursive: true });
	await mkdir(join(cronDir, "capabilities"), { recursive: true });
	await mkdir(join(cronDir, "output"), { recursive: true });
}

async function listFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	async function walk(dir: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name === "output") continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(path);
			} else if (entry.isFile()) {
				files.push(relative(root, path));
			}
		}
	}
	await walk(root);
	return files.sort();
}

function isInside(parent: string, candidate: string): boolean {
	const rel = relative(resolve(parent), resolve(candidate));
	return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function normalizeGeneratedPath(cronDir: string, path: string): string | undefined {
	const absolute = resolve(cronDir, path);
	if (!isInside(cronDir, absolute)) return undefined;
	return relative(cronDir, absolute);
}

function extractChangedFiles(cronDir: string, items: ThreadItem[]): {
	files: string[];
	diagnostics: ValidationDiagnostic[];
} {
	const files = new Set<string>();
	const diagnostics: ValidationDiagnostic[] = [];
	for (const item of items) {
		if (item.type !== "file_change") continue;
		const changeItem = item as FileChangeItem;
		for (const change of changeItem.changes) {
			const normalized = normalizeGeneratedPath(cronDir, change.path);
			if (!normalized) {
				diagnostics.push({
					level: "error",
					file: change.path,
					message: "Codex attempted to change a path outside cronDir.",
				});
			} else {
				files.add(normalized);
			}
		}
	}
	return { files: Array.from(files).sort(), diagnostics };
}

async function buildPrompt(cronDir: string, request: string): Promise<string> {
	const [jobs, capabilities, files] = await Promise.all([
		scanCronJobs(cronDir),
		scanCapabilities(cronDir),
		listFiles(cronDir),
	]);

	return [
		"You are generating Mini-Claw cron artifacts.",
		"",
		"Write files only inside this working directory. Do not edit files outside it.",
		"Use this required structure:",
		"- jobs/<name>.mjs",
		"- jobs/<name>.cron",
		"- capabilities/<seq-name>/manifest.yaml",
		"- capabilities/<seq-name>/index.mjs",
		"",
		"Job rules:",
		"- Use ESM .mjs files.",
		"- Use #cron/capabilities/... imports when a job uses a capability.",
		"- A .cron file contains only the cron expression.",
		"- Job names must use letters, numbers, dashes, or underscores.",
		"- Output is log-only by default; do not send Telegram messages.",
		"",
		"Existing jobs:",
		jobs.jobs.length
			? jobs.jobs.map((job) => `- ${job.name}: ${job.cron}`).join("\n")
			: "- none",
		"",
		"Existing capabilities:",
		capabilities.capabilities.length
			? capabilities.capabilities.map((capability) => `- ${capability.name}: ${capability.description}`).join("\n")
			: "- none",
		"",
		"Existing cron files:",
		files.length ? files.map((file) => `- ${file}`).join("\n") : "- none",
		"",
		"User request:",
		request,
		"",
		"Return JSON matching the requested schema with a concise summary and the files you created or updated.",
	].join("\n");
}

function parseStructuredResponse(response: string): { summary?: string; files?: string[] } {
	try {
		const parsed = JSON.parse(response) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const record = parsed as Record<string, unknown>;
		return {
			summary: typeof record.summary === "string" ? record.summary : undefined,
			files: Array.isArray(record.files)
				? record.files.filter((item): item is string => typeof item === "string")
				: undefined,
		};
	} catch {
		return {};
	}
}

export async function generateCronArtifacts(
	input: GenerateCronArtifactsInput,
	options: GenerateCronArtifactsOptions = {},
): Promise<GenerateCronArtifactsResult> {
	const cronDir = resolve(input.cronDir);
	await ensureCronDirectories(cronDir);
	const beforeFiles = new Set(await listFiles(cronDir));
	const prompt = await buildPrompt(cronDir, input.request);
	const codex = options.codex ?? new Codex();
	const thread = codex.startThread({
		workingDirectory: cronDir,
		sandboxMode: "workspace-write",
		skipGitRepoCheck: true,
		approvalPolicy: "never",
		networkAccessEnabled: true,
	});

	const turn = await thread.run(prompt, { outputSchema: OUTPUT_SCHEMA });
	const afterFiles = await listFiles(cronDir);
	const changed = extractChangedFiles(cronDir, turn.items);
	const response = parseStructuredResponse(turn.finalResponse);
	const generatedFiles = new Set<string>([
		...changed.files,
		...(response.files ?? []).map((file) => normalizeGeneratedPath(cronDir, file)).filter((file): file is string => !!file),
		...afterFiles.filter((file) => !beforeFiles.has(file)),
	]);

	const [jobs, capabilities] = await Promise.all([
		scanCronJobs(cronDir),
		scanCapabilities(cronDir),
	]);

	const diagnostics = [
		...changed.diagnostics,
		...jobs.diagnostics,
		...capabilities.diagnostics,
	];
	const files = Array.from(generatedFiles).sort();
	let pm2Restart: Pm2RestartResult | undefined;
	const shouldRestart = input.restartCron !== false &&
		files.length > 0 &&
		!diagnostics.some((diagnostic) => diagnostic.level === "error");

	if (shouldRestart) {
		const restart = options.restartCronProcess ?? ((appRoot: string) => restartCronPm2({ appRoot }));
		pm2Restart = await restart(resolve(input.appRoot));
		if (!pm2Restart.ok) {
			diagnostics.push({
				level: "warn",
				message: `Cron artifacts were generated, but pm2 could not restart ${pm2Restart.processName}: ${pm2Restart.error ?? pm2Restart.stderr}`,
			});
		}
	}

	return {
		summary: response.summary ?? (turn.finalResponse.trim() || "Cron artifacts generated."),
		files,
		diagnostics,
		finalResponse: turn.finalResponse,
		pm2Restart,
	};
}

export async function describeCronDir(cronDir: string): Promise<string> {
	const resolvedCronDir = resolve(cronDir);
	const files = await listFiles(resolvedCronDir);
	if (files.length === 0) return "No cron artifacts exist yet.";
	const lines: string[] = [];
	for (const file of files) {
		const fullPath = join(resolvedCronDir, file);
		const stats = await stat(fullPath);
		lines.push(`${file} (${stats.size} bytes)`);
	}
	return lines.join("\n");
}

export function formatGeneratedFiles(files: string[]): string {
	if (files.length === 0) return "No file changes were reported.";
	return files.map((file) => `- ${join("cron", file)}`).join("\n");
}

export function inferCronRootFromScheduler(schedulerPath: string): string {
	return dirname(resolve(schedulerPath));
}

export function cronArtifactName(path: string): string {
	return basename(path);
}
