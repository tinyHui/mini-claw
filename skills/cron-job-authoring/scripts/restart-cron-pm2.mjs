#!/usr/bin/env node
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..", "..", "..");
const processName = process.argv[2] || "mini-claw-cron";
const pm2Bin = join(appRoot, "node_modules", "pm2", "bin", "pm2");

execFile(
	process.execPath,
	[pm2Bin, "restart", processName],
	{ cwd: appRoot, timeout: 15_000 },
	(error, stdout, stderr) => {
		if (stdout) process.stdout.write(stdout);
		if (stderr) process.stderr.write(stderr);
		if (error) {
			console.error(`Failed to restart ${processName}: ${error.message}`);
			process.exit(1);
		}
		console.log(`Restarted ${processName}`);
	},
);
