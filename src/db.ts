import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { logger } from "./logger.js";

let db: DatabaseType | null = null;

export function initializeDatabase(workspaceFolder: string): DatabaseType {
	const dbPath = join(workspaceFolder, "miniclaw.db");

	if (existsSync(dbPath)) {
		logger.info(`Database already exists at ${dbPath}, skipping initialization`);
		db = new Database(dbPath);
		db.pragma("journal_mode = WAL");
		db.pragma("foreign_keys = ON");
		return db;
	}

	logger.warn(`Database not found at ${dbPath}, creating and initializing`);

	mkdirSync(workspaceFolder, { recursive: true });

	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	db.exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id              TEXT    NOT NULL PRIMARY KEY,
			model           TEXT    NOT NULL,
			thinkingLevel   TEXT    NOT NULL,
			budget_minimal  INTEGER NOT NULL DEFAULT 0,
			budget_low      INTEGER NOT NULL DEFAULT 0,
			budget_medium   INTEGER NOT NULL DEFAULT 0,
			budget_high     INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS messages (
			id          TEXT    NOT NULL,
			sessionId   TEXT    NOT NULL,
			parentId    TEXT,
			timeStamp   TEXT    NOT NULL,
			role        TEXT    NOT NULL,
			content     TEXT    NOT NULL,
			PRIMARY KEY (id, sessionId),
			FOREIGN KEY (sessionId) REFERENCES sessions(id)
		);
	`);

	logger.info("Database initialized");
	return db;
}

export function getDb(): DatabaseType {
	if (!db) {
		throw new Error("Database not initialized. Call initializeDatabase() first.");
	}
	return db;
}
