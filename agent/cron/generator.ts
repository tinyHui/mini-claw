import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { Codex, type FileChangeItem, type ThreadItem } from "@openai/codex-sdk";
import { getSqlite } from "../db.js";
import { restartCronPm2, type Pm2RestartResult } from "./pm2.js";

const execFileAsync = promisify(execFile);

export interface ValidationDiagnostic {
	level: "error" | "warn";
	message: string;
	file?: string;
}

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
	readCronContext?: () => CronRegistryContext;
	runValidator?: (input: {
		appRoot: string;
		cronDir: string;
	}) => Promise<ValidatorProcessResult>;
}

export interface CronRegistryJob {
	name: string;
	description: string;
	cronExpression: string;
}

export interface CronRegistryCapability {
	slug: string;
	name: string;
	description: string;
	inputSchemaJson: string;
	outputSchemaJson: string;
}

export interface CronRegistryContext {
	jobs: CronRegistryJob[];
	capabilities: CronRegistryCapability[];
}

export interface ValidatorProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface ValidatorJson {
	ok?: boolean;
	errors?: ValidationDiagnostic[];
	warnings?: ValidationDiagnostic[];
	counts?: {
		errors?: number;
		warnings?: number;
	};
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
	await mkdir(join(cronDir, "jobs"), { recursive: true });
	await mkdir(join(cronDir, "capabilities"), { recursive: true });
	await mkdir(join(cronDir, "output"), { recursive: true });
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

function readCronRegistryContext(): CronRegistryContext {
	const sqlite = getSqlite();
	const jobs = sqlite
		.prepare("SELECT name, description, cronExpression FROM cron_jobs ORDER BY name")
		.all() as CronRegistryJob[];
	const capabilities = sqlite
		.prepare(
			"SELECT slug, name, description, inputSchemaJson, outputSchemaJson FROM cron_capabilities ORDER BY slug",
		)
		.all() as CronRegistryCapability[];
	return { jobs, capabilities };
}

function buildPrompt(context: CronRegistryContext, request: string): string {
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
		"- Every job .mjs file must include a top-level static comment: // description: <human-readable purpose>.",
		"- Job names must use letters, numbers, dashes, or underscores.",
		"- Output is log-only by default; do not send Telegram messages.",
		"",
		"Existing jobs:",
		context.jobs.length
			? context.jobs.map((job) => `- ${job.name}: ${job.description} (${job.cronExpression})`).join("\n")
			: "- none",
		"",
		"Existing capabilities:",
		context.capabilities.length
			? context.capabilities.map((capability) => `- ${capability.slug} (${capability.name}): ${capability.description}`).join("\n")
			: "- none",
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

async function runCronValidator(input: { appRoot: string; cronDir: string }): Promise<ValidatorProcessResult> {
	const validatorPath = join(input.appRoot, "cron", "validator.mjs");
	const args = [validatorPath, "--cron-dir", input.cronDir, "--json", "--write-db"];
	try {
		const result = await execFileAsync(process.execPath, args, {
			cwd: input.appRoot,
			encoding: "utf-8",
			maxBuffer: 1024 * 1024 * 10,
		});
		return {
			exitCode: 0,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch (error) {
		const failed = error as Error & {
			code?: number;
			stdout?: string;
			stderr?: string;
		};
		return {
			exitCode: typeof failed.code === "number" ? failed.code : 1,
			stdout: failed.stdout ?? "",
			stderr: failed.stderr ?? failed.message,
		};
	}
}

function parseValidatorOutput(result: ValidatorProcessResult): {
	diagnostics: ValidationDiagnostic[];
	ok: boolean;
} {
	const diagnostics: ValidationDiagnostic[] = [];
	let parsed: ValidatorJson | undefined;
	try {
		parsed = JSON.parse(result.stdout) as ValidatorJson;
	} catch {
		const detail = result.stderr.trim() || result.stdout.trim() || `Validator exited with code ${result.exitCode}.`;
		diagnostics.push({
			level: "error",
			message: `Cron validator did not return JSON: ${detail}`,
		});
		return { diagnostics, ok: false };
	}

	diagnostics.push(...(parsed.errors ?? []));
	diagnostics.push(...(parsed.warnings ?? []));
	const hasErrors =
		result.exitCode !== 0 ||
		parsed.ok === false ||
		(parsed.counts?.errors ?? 0) > 0 ||
		diagnostics.some((diagnostic) => diagnostic.level === "error");
	return { diagnostics, ok: !hasErrors };
}

export async function generateCronArtifacts(
	input: GenerateCronArtifactsInput,
	options: GenerateCronArtifactsOptions = {},
): Promise<GenerateCronArtifactsResult> {
	const cronDir = resolve(input.cronDir);
	const appRoot = resolve(input.appRoot);
	await ensureCronDirectories(cronDir);
	const context = (options.readCronContext ?? readCronRegistryContext)();
	const prompt = buildPrompt(context, input.request);
	const codex = options.codex ?? new Codex();
	const thread = codex.startThread({
		workingDirectory: cronDir,
		sandboxMode: "workspace-write",
		skipGitRepoCheck: true,
		approvalPolicy: "never",
		networkAccessEnabled: true,
	});

	const turn = await thread.run(prompt, { outputSchema: OUTPUT_SCHEMA });
	const changed = extractChangedFiles(cronDir, turn.items);
	const response = parseStructuredResponse(turn.finalResponse);
	const generatedFiles = new Set<string>([
		...changed.files,
		...(response.files ?? []).map((file) => normalizeGeneratedPath(cronDir, file)).filter((file): file is string => !!file),
	]);

	const validator = options.runValidator ?? runCronValidator;
	const validatorResult = await validator({ appRoot, cronDir });
	const validatorParsed = parseValidatorOutput(validatorResult);
	const diagnostics = [...changed.diagnostics, ...validatorParsed.diagnostics];
	const files = Array.from(generatedFiles).sort();
	let pm2Restart: Pm2RestartResult | undefined;
	const shouldRestart = input.restartCron !== false &&
		files.length > 0 &&
		validatorParsed.ok &&
		!diagnostics.some((diagnostic) => diagnostic.level === "error");

	if (shouldRestart) {
		const restart = options.restartCronProcess ?? ((appRoot: string) => restartCronPm2({ appRoot }));
		pm2Restart = await restart(appRoot);
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

export function describeCronRegistry(context = readCronRegistryContext()): string {
	if (context.jobs.length === 0 && context.capabilities.length === 0) {
		return "No cron artifacts are registered yet.";
	}
	const lines = [
		...context.jobs.map((job) => `job ${job.name}: ${job.description} (${job.cronExpression})`),
		...context.capabilities.map((capability) => `capability ${capability.slug}: ${capability.description}`),
	];
	return lines.join("\n");
}

export function formatGeneratedFiles(files: string[]): string {
	if (files.length === 0) return "No file changes were reported.";
	return files.map((file) => `- ${join("cron", file)}`).join("\n");
}
