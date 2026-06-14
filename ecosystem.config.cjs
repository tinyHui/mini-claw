const path = require("node:path");
const dotenv = require("dotenv");

const appRoot = process.env.MINI_CLAW_PM2_APP_ROOT || process.cwd();
const envFile = process.env.MINI_CLAW_ENV_FILE || path.join(appRoot, ".env");
const fileEnv = dotenv.config({ path: envFile, quiet: true }).parsed || {};
const sharedEnv = {
	...fileEnv,
	NODE_ENV: "production",
	MINI_CLAW_APP_ROOT:
		fileEnv.MINI_CLAW_APP_ROOT || process.env.MINI_CLAW_APP_ROOT || appRoot,
	MINI_CLAW_CRON_DIR:
		fileEnv.MINI_CLAW_CRON_DIR || process.env.MINI_CLAW_CRON_DIR || path.join(appRoot, "generated", "cron"),
};

module.exports = {
	apps: [
		{
			name: "mini-claw",
			script: "dist/agent/index.js",
			cwd: appRoot,
			interpreter: "node",
			time: true,
			env: sharedEnv,
		},
		{
			name: "mini-claw-cron",
			script: "dist/cron/scheduler.js",
			cwd: appRoot,
			interpreter: "node",
			time: true,
			env: sharedEnv,
		},
		{
			name: "mini-claw-mailman",
			script: "dist/mailman/telegram-cron-output.js",
			cwd: appRoot,
			interpreter: "node",
			time: true,
			env: sharedEnv,
		},
	],
};
