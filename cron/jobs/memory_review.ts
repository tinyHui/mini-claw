// description: Review recent processed chat messages and update Mini-Claw memory.
import { loadConfig } from "../../agent/config.js";
import { initializeDatabase } from "../../agent/db.js";
import { runMemoryReviewOnce } from "#memory/worker.js";

export async function run(): Promise<void> {
	const config = loadConfig();
	initializeDatabase();
	const result = await runMemoryReviewOnce(config);
	if (result.status === "failed") {
		throw new Error(result.error ?? "Memory review failed.");
	}
}
