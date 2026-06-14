import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["agent/**/*.test.ts", "cron/*.test.ts", "mailman/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			include: ["agent/**/*.ts", "cron/**/*.ts", "mailman/**/*.ts"],
			exclude: ["agent/**/*.test.ts", "cron/**/*.test.ts", "mailman/**/*.test.ts", "agent/index.ts", "agent/bot.ts"],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80,
			},
		},
		mockReset: true,
		restoreMocks: true,
	},
});
