import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { restartCronPm2 } from "../cron/pm2.js";
import { getJobScriptPath } from "../../cron/paths.js";
import { getSqlite } from "../db.js";
import { logger, withLogContext } from "../logger.js";
import {
	applyPendingMemoryProposal,
	getMemoryStatus,
	listPendingMemoryProposals,
	rejectMemoryProposal,
} from "../memory/proposals.js";
import type { MemoryReviewRunResult } from "../memory/worker.js";
import { ensureSession, resetSession } from "../session-repository.js";
import { formatPath, getWorkspace } from "../workspace.js";
import type {
	IncomingTelegramUpdate,
	ProcessorContext,
	ProcessorResult,
	TelegramProcessor,
} from "./types.js";

interface CronCommandJobRow {
	name: string;
	cronExpression: string;
	enabled: number;
}

interface CronCommandJobLookupRow extends CronCommandJobRow {
	description: string;
	scriptPath: string;
}

export class CommandProcessor implements TelegramProcessor {
	canHandle(update: IncomingTelegramUpdate): boolean {
		return update.kind === "command";
	}

	async process(
		update: IncomingTelegramUpdate,
		context: ProcessorContext,
	): Promise<ProcessorResult> {
		if (update.kind !== "command") {
			throw new Error("CommandProcessor received a non-command update");
		}

		await context.progress.step({
			type: "command",
			description: `Handling /${update.command}`,
			key: "command:handle",
		});

		switch (update.command) {
			case "new":
				return this.handleNewCommand(update);
			case "status":
				return this.handleStatusCommand(update);
			case "cron":
				return this.handleCronCommand(update, context);
			case "memory":
				return this.handleMemoryCommand(update, context);
			default:
				return { content: `Unknown command: /${update.command}` };
		}
	}

	private async handleNewCommand(
		update: Extract<IncomingTelegramUpdate, { kind: "command" }>,
	): Promise<ProcessorResult> {
		const session = resetSession();
		await withLogContext(
			{
				operation: "session_reset",
				chatId: update.chatId,
				sessionId: session.id,
			},
			() => {
				logger.info("Started a new session");
			},
		);
		return { content: "New session started." };
	}

	private async handleStatusCommand(
		update: Extract<IncomingTelegramUpdate, { kind: "command" }>,
	): Promise<ProcessorResult> {
		const cwd = await getWorkspace(update.chatId);
		const session = ensureSession();
		return {
			content: `Status:\n- Chat ID: ${update.chatId}\n- Workspace: ${formatPath(cwd)}\n- Session: ${session.id.slice(0, 8)}…`,
		};
	}

	private async handleCronCommand(
		update: Extract<IncomingTelegramUpdate, { kind: "command" }>,
		context: ProcessorContext,
	): Promise<ProcessorResult> {
		const [action, name] = update.args;
		if (!action) return { content: this.formatCronHelp() };

		if (action === "list") {
			return { content: this.formatCronList() };
		}

		if (action === "restart") {
			return { content: await this.restartCronFromCommand(update.chatId, context) };
		}

		if ((action === "disable" || action === "enable") && name) {
			return {
				content: await this.setCronEnabledFromCommand(
					update.chatId,
					context,
					name,
					action === "enable",
				),
			};
		}

		return { content: this.formatCronHelp() };
	}

	private async handleMemoryCommand(
		update: Extract<IncomingTelegramUpdate, { kind: "command" }>,
		context: ProcessorContext,
	): Promise<ProcessorResult> {
		const [action, id] = update.args;
		if (!action) return { content: this.formatMemoryHelp() };

		if (action === "pending") {
			return { content: this.formatPendingMemoryProposals() };
		}

		if (action === "status") {
			return { content: this.formatMemoryStatus(context) };
		}

		if (action === "run") {
			return { content: await this.runMemoryReviewFromCommand(context) };
		}

		if (action === "approve" && id) {
			const result = await applyPendingMemoryProposal(context.config.workspace, id);
			return {
				content: result ? `Approved memory proposal ${id}.` : `Pending memory proposal not found: ${id}`,
			};
		}

		if (action === "reject" && id) {
			const rejected = rejectMemoryProposal(id);
			return {
				content: rejected ? `Rejected memory proposal ${id}.` : `Pending memory proposal not found: ${id}`,
			};
		}

		return { content: this.formatMemoryHelp() };
	}

	private async restartCronFromCommand(
		chatId: string,
		context: ProcessorContext,
	): Promise<string> {
		return withLogContext(
			{
				operation: "cron_scheduler_restart",
				chatId,
			},
			async () => {
				await context.progress.step({
					type: "command",
					description: "Restarting cron scheduler",
					key: "cron:restart",
				});
				const result = await restartCronPm2({ appRoot: context.config.appRoot });
				if (result.ok) {
					logger.info("Restarted cron process via pm2");
					return `Cron scheduler restarted (${result.processName}).`;
				}

				const errorMessage = result.error ?? (result.stderr || "unknown error");
				logger.warn("Failed to restart cron process via pm2", {
					error: errorMessage,
				});
				return `Failed to restart cron scheduler (${result.processName}): ${errorMessage}`;
			},
		);
	}

	private async runMemoryReviewFromCommand(context: ProcessorContext): Promise<string> {
		const log = ["Starting manual memory review."];
		await context.progress.step({
			type: "memory",
			description: "Starting manual memory review",
			key: "memory:start",
		});

		if (!context.memoryWorker) {
			log.push("Memory review worker is unavailable.");
			await context.progress.step({
				type: "memory",
				description: "Memory review worker unavailable",
				key: "memory:unavailable",
			});
			return this.formatMemoryRunLog(log);
		}

		const result = await context.memoryWorker.runOnce(async (message) => {
			log.push(message);
			await context.progress.step({
				type: this.progressTypeForMemoryMessage(message),
				description: this.formatMemoryProgressDescription(message),
				key: this.progressKeyForMemoryMessage(message),
			});
		});

		log.push(this.formatMemoryRunResult(result));
		return this.formatMemoryRunLog(log);
	}

	private formatMemoryRunLog(log: string[]): string {
		return [
			"Memory review run:",
			...log.map((line) => `- ${line}`),
		].join("\n");
	}

	private formatMemoryRunResult(result: MemoryReviewRunResult): string {
		if (result.status === "completed") {
			return [
				`Completed: reviewed ${result.reviewedMessages} message${result.reviewedMessages === 1 ? "" : "s"}.`,
				`Applied ${result.accepted}, staged ${result.staged}, rejected ${result.rejected}.`,
			].join(" ");
		}
		if (result.status === "failed") {
			return `Failed: ${result.error ?? "unknown error"}.`;
		}
		if (result.status === "no_messages") return "Completed: no messages needed review.";
		if (result.status === "disabled") return "Skipped: memory review is disabled.";
		return "Skipped: another memory review is already running.";
	}

	private progressTypeForMemoryMessage(message: string) {
		if (message.startsWith("Reviewing ")) return "review" as const;
		if (message.startsWith("Marking ")) return "review" as const;
		return "memory" as const;
	}

	private progressKeyForMemoryMessage(message: string): string {
		if (message.startsWith("Preparing ")) return "memory:prepare";
		if (message.startsWith("Loading ")) return "memory:load";
		if (message.startsWith("Reviewing ")) return "memory:review";
		if (message.startsWith("Marking ")) return "memory:mark";
		if (message.startsWith("No processed ")) return "memory:none";
		if (message.startsWith("Memory review failed")) return "memory:failed";
		return `memory:${message}`;
	}

	private formatMemoryProgressDescription(message: string): string {
		return message.replace(/\.$/, "");
	}

	private formatMemoryHelp(): string {
		return [
			"Memory commands:",
			"/memory status",
			"/memory pending",
			"/memory approve <id>",
			"/memory reject <id>",
			"/memory run",
		].join("\n");
	}

	private formatPendingMemoryProposals(): string {
		const rows = listPendingMemoryProposals();
		if (rows.length === 0) return "No pending memory proposals.";
		return [
			"Pending memory proposals:",
			...rows.map((row) => [
				`- ${row.id.slice(0, 8)} (${row.target})`,
				`  ${row.entry}`,
				`  Rationale: ${row.rationale}`,
			].join("\n")),
		].join("\n");
	}

	private formatMemoryStatus(context: ProcessorContext): string {
		const status = getMemoryStatus();
		return [
			"Memory review:",
			`- Enabled: ${context.config.memoryReviewEnabled ? "yes" : "no"}`,
			`- Interval: ${context.config.memoryReviewIntervalMs}ms`,
			`- Batch limit: ${context.config.memoryReviewBatchLimit}`,
			`- Pending: ${status.pending}`,
			`- Applied: ${status.applied}`,
			`- Rejected: ${status.rejected}`,
			`- Last review: ${context.memoryWorker?.getLastReviewAt() ?? "never"}`,
		].join("\n");
	}

	private formatCronHelp(): string {
		return [
			"Cron commands:",
			"/cron list",
			"/cron disable <name>",
			"/cron enable <name>",
			"/cron restart",
		].join("\n");
	}

	private formatCronList(): string {
		const rows = getSqlite().prepare(`
			SELECT name, cronExpression, enabled
			FROM cron_jobs
			ORDER BY name
		`).all() as CronCommandJobRow[];

		if (rows.length === 0) return "No cron jobs registered.";

		return [
			"Cron jobs:",
			...rows.map((row) => `- ${row.name}: ${row.cronExpression} (${row.enabled === 1 ? "enabled" : "disabled"})`),
		].join("\n");
	}

	private getCronJob(name: string): CronCommandJobLookupRow | undefined {
		return getSqlite().prepare(`
			SELECT name, description, cronExpression, enabled, scriptPath
			FROM cron_jobs
			WHERE name = ?
		`).get(name) as CronCommandJobLookupRow | undefined;
	}

	private cronJobScriptExists(context: ProcessorContext, job: CronCommandJobLookupRow): boolean {
		if (!job.scriptPath || job.scriptPath === `${job.name}.mjs`) {
			return existsSync(getJobScriptPath(context.config.cronDir, job.name));
		}
		const appPath = resolve(context.config.appRoot, job.scriptPath);
		if (existsSync(appPath)) return true;
		if (extname(appPath) === ".js") {
			return existsSync(appPath.slice(0, -".js".length) + ".ts");
		}
		return false;
	}

	private async setCronEnabledFromCommand(
		chatId: string,
		context: ProcessorContext,
		name: string,
		enabled: boolean,
	): Promise<string> {
		return withLogContext(
			{
				operation: enabled ? "cron_enable" : "cron_disable",
				chatId,
				jobName: name,
			},
			async () => {
				await context.progress.step({
					type: "command",
					description: `${enabled ? "Enabling" : "Disabling"} cron job ${name}`,
					key: `cron:${enabled ? "enable" : "disable"}:${name}`,
				});
				const job = this.getCronJob(name);
				if (!job) {
					return `Cron job not found: ${name}`;
				}

				if (enabled && !this.cronJobScriptExists(context, job)) {
					return `Cannot enable ${name}: ${job.scriptPath} was not found.`;
				}

				getSqlite().prepare("UPDATE cron_jobs SET enabled = ? WHERE name = ?").run(enabled ? 1 : 0, name);
				await context.progress.step({
					type: "command",
					description: "Restarting cron scheduler",
					key: "cron:restart",
				});
				const result = await restartCronPm2({ appRoot: context.config.appRoot });
				if (result.ok) {
					logger.info(enabled ? "Enabled cron job and restarted cron process" : "Disabled cron job and restarted cron process");
					return `Cron job ${name} ${enabled ? "enabled" : "disabled"}. Restarted ${result.processName}.`;
				}

				const errorMessage = result.error ?? (result.stderr || "unknown error");
				logger.warn("Failed to restart cron process after cron job status update", {
					error: errorMessage,
				});
				return `Cron job ${name} ${enabled ? "enabled" : "disabled"}, but failed to restart ${result.processName}: ${errorMessage}`;
			},
		);
	}
}

export function createCommandProcessor(): CommandProcessor {
	return new CommandProcessor();
}
