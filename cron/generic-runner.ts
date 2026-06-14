import { isMainThread, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { logger } from "./logger.js";
import { publishCronOutput } from "./output-store.js";
import { validateJobName } from "./validation.js";
import { getDefaultGeneratedCronDir, getJobScriptPath } from "./paths.js";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface CronTaskInput {
	task: string;
	cronDir?: string;
	dbPath?: string;
}

export async function executeCronTask({
	task,
	cronDir = getDefaultGeneratedCronDir(),
	dbPath,
}: CronTaskInput) {
	const nameErrors = validateJobName(task);
	if (nameErrors.length > 0) {
		throw new Error(`Invalid cron task "${task}": ${nameErrors.join(" ")}`);
	}

	const modulePath = getJobScriptPath(cronDir, task);
	const imported = await import(pathToFileURL(modulePath).href);
	if (typeof imported.run !== "function") {
		throw new Error(`Cron task "${task}" must export async function run().`);
	}

	const result = await imported.run();
	if (typeof result !== "string") {
		throw new Error(`Cron task "${task}" run() must return a string.`);
	}

	return publishCronOutput({ jobName: task, content: result }, dbPath);
}

export async function runGenericCronWorker(data = workerData as Partial<CronTaskInput> | undefined) {
	const task = data?.task;
	if (typeof task !== "string" || task.trim() === "") {
		throw new Error("Generic cron runner requires workerData.task.");
	}
	const cronDir = data?.cronDir;
	const dbPath = data?.dbPath;

	try {
		const row = await executeCronTask({
			task,
			cronDir,
			dbPath,
		});
		logger.info("Cron task output persisted", {
			operation: "cron_task_output_persisted",
			jobName: task,
			outputId: row.id,
		});
		return row;
	} catch (error) {
		const message = errorMessage(error);
		logger.error("Cron task failed", error, {
			operation: "cron_task_failed",
			jobName: task,
		});
		publishCronOutput({
			jobName: task,
			content: `Cron task "${task}" failed:\n${message}`,
		}, dbPath);
		throw error;
	}
}

if (!isMainThread || process.argv[1] === new URL(import.meta.url).pathname) {
	const cliTask = process.argv[2];
	const cliCronDir = process.argv[3];
	await runGenericCronWorker(
		workerData ?? (cliTask ? { task: cliTask, cronDir: cliCronDir } : undefined),
	);
}
