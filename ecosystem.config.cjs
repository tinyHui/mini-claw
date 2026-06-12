module.exports = {
	apps: [
		{
			name: "mini-claw",
			script: "dist/index.js",
			interpreter: "node",
			time: true,
			env: {
				NODE_ENV: "production",
			},
		},
		{
			name: "mini-claw-cron",
			script: "cron/scheduler.mjs",
			interpreter: "node",
			time: true,
			env: {
				NODE_ENV: "production",
			},
		},
	],
};
