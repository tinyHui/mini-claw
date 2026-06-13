import { randomUUID } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";

export function getDefaultDatabasePath() {
	return join(process.cwd(), "miniclaw.db");
}

export function publishCronOutput(
	{ jobName, content, channel = "telegram" },
	dbPath = getDefaultDatabasePath(),
) {
	const sqlite = new Database(dbPath, { fileMustExist: true });
	try {
		const row = {
			id: randomUUID(),
			jobName,
			channel,
			content,
			created_at: new Date().toISOString(),
			send_at: null,
			fail_reason: null,
		};
		sqlite.prepare(`
			INSERT INTO mailbox (
				id, jobName, channel, content, created_at, send_at, fail_reason
			) VALUES (
				@id, @jobName, @channel, @content, @created_at, @send_at, @fail_reason
			)
		`).run(row);
		return row;
	} finally {
		sqlite.close();
	}
}
