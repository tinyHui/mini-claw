import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

export interface Pm2RestartResult {
	ok: boolean;
	processName: string;
	command: string;
	stdout: string;
	stderr: string;
	error?: string;
}

export interface RestartCronPm2Options {
	appRoot: string;
	processName?: string;
	timeoutMs?: number;
}

const require = createRequire(import.meta.url);

function resolvePm2Bin(appRoot: string): string {
	try {
		return require.resolve("pm2/bin/pm2");
	} catch {
		return join(resolve(appRoot), "node_modules", "pm2", "bin", "pm2");
	}
}

export async function restartCronPm2(
	options: RestartCronPm2Options,
): Promise<Pm2RestartResult> {
	const processName = options.processName ?? "mini-claw-cron";
	const pm2Bin = resolvePm2Bin(options.appRoot);
	const args = [pm2Bin, "restart", processName];
	const command = `${process.execPath} ${args.join(" ")}`;

	return new Promise((resolveResult) => {
		execFile(
			process.execPath,
			args,
			{
				cwd: options.appRoot,
				timeout: options.timeoutMs ?? 15_000,
			},
			(error, stdout, stderr) => {
				resolveResult({
					ok: !error,
					processName,
					command,
					stdout,
					stderr,
					error: error ? error.message : undefined,
				});
			},
		);
	});
}
