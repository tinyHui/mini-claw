import { randomUUID } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";

export function getDefaultDatabasePath() {
	return join(process.cwd(), "miniclaw.db");
}

export function publishCronOutput(
	{ jobName, content, status = "pending", error = null },
	dbPath = getDefaultDatabasePath(),
) {
	const sqlite = new Database(dbPath, { fileMustExist: true });
	try {
		const row = {
			id: randomUUID(),
			jobName,
			content,
			status,
			createdAt: new Date().toISOString(),
			error,
		};
		sqlite.prepare(`
			INSERT INTO cron_outputs (
				id, jobName, content, status, createdAt, error
			) VALUES (
				@id, @jobName, @content, @status, @createdAt, @error
			)
		`).run(row);
		return row;
	} finally {
		sqlite.close();
	}
}
